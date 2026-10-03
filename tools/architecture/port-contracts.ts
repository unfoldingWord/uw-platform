export type SourceTree = { readonly paths: readonly string[]; read(path: string): string };

const adapterRoots = ['apps/uw-app/ports/', 'sim/adapters/'] as const;
const contractRoot = 'packages/harness/port-contracts/';
const contractTest = /\.contract(\.pg)?\.test\.ts$/;

function kebab(port: string): string {
  return port.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

function suiteName(port: string): string {
  return `describe${port.charAt(0).toUpperCase()}${port.slice(1)}Contract`;
}

function directlyIn(tree: SourceTree, root: string): string[] {
  return tree.paths.filter(
    (path) => path.startsWith(root) && !path.slice(root.length).includes('/'),
  );
}

function portOf(file: string, root: string, ports: readonly string[]): string | undefined {
  const base = file.slice(root.length).split('.')[0];
  return ports.find((port) => kebab(port) === base);
}

const notWiredSuffix = '.not-wired.ts';

function notWiredName(port: string): string {
  return `describe${port.charAt(0).toUpperCase()}${port.slice(1)}NotWired`;
}

function hasNotWiredAdapter(port: string, tree: SourceTree): boolean {
  return adapterRoots.some((root) => tree.paths.includes(`${root}${kebab(port)}${notWiredSuffix}`));
}

function suiteViolations(ports: readonly string[], tree: SourceTree): string[] {
  return ports.flatMap((port) => {
    const path = `${contractRoot}${kebab(port)}.ts`;
    if (!tree.paths.includes(path)) return [`${port}: no contract suite at ${path}`];
    const source = tree.read(path);
    const required = [
      suiteName(port),
      ...(hasNotWiredAdapter(port, tree) ? [notWiredName(port)] : []),
    ];
    return required
      .filter((name) => !source.includes(`export function ${name}(`))
      .map((name) => `${port}: ${path} does not export ${name}`);
  });
}

function importedNames(source: string, specifier: string): string[] {
  return [...source.matchAll(/import\s*\{([^}]*)\}\s*from\s*'([^']+)'/g)]
    .filter((match) => match[2] === specifier)
    .flatMap((match) => (match[1] ?? '').split(','))
    .map((name) => (name.split(' as ').pop() ?? '').trim())
    .filter((name) => name !== '');
}

function callArguments(source: string, name: string): string[] {
  const found: string[] = [];
  let from = source.indexOf(`${name}(`);
  while (from !== -1) {
    const open = from + name.length;
    let depth = 0;
    let end = open;
    for (; end < source.length; end += 1) {
      depth += source.charAt(end) === '(' ? 1 : source.charAt(end) === ')' ? -1 : 0;
      if (depth === 0) break;
    }
    found.push(source.slice(open + 1, end));
    from = source.indexOf(`${name}(`, end);
  }
  return found;
}

function mentions(text: string, identifier: string): boolean {
  return text.split(/[^A-Za-z0-9_$]+/).includes(identifier);
}

function runsAdapter(source: string, file: string, port: string): boolean {
  const base = file.slice(file.lastIndexOf('/') + 1);
  const suite = file.endsWith(notWiredSuffix) ? notWiredName(port) : suiteName(port);
  if (!importedNames(source, `@uw/harness/port-contracts/${kebab(port)}`).includes(suite)) {
    return false;
  }
  const bindings = importedNames(source, `./${base}`);
  return callArguments(source, suite).some((args) =>
    bindings.some((binding) => mentions(args, binding)),
  );
}

function rootViolations(ports: readonly string[], tree: SourceTree, root: string): string[] {
  const files = directlyIn(tree, root);
  const adapters = files.filter((path) => path.endsWith('.ts') && !path.endsWith('.test.ts'));
  const tests = files.filter((path) => contractTest.test(path));
  const unnamed = adapters
    .filter((file) => portOf(file, root, ports) === undefined)
    .map((file) => `${file}: an adapter file must be named for its port`);
  const missing = ports
    .filter((port) => !adapters.some((file) => portOf(file, root, ports) === port))
    .map((port) => `${port}: no adapter in ${root}`);
  const unrun = adapters.flatMap((file) => {
    const port = portOf(file, root, ports);
    if (port === undefined || tests.some((test) => runsAdapter(tree.read(test), file, port))) {
      return [];
    }
    return [`${file}: no contract test in ${root} runs it against the ${port} contract`];
  });
  return [...unnamed, ...missing, ...unrun];
}

const engineTurn =
  /^apps\/uw-app\/engines\/(?:claude-messages|openrouter-messages|claude-code-sandbox|codex-sandbox|claude-managed-agent|external)\/turn\.ts$/;

function engineTurnViolations(ports: readonly string[], tree: SourceTree): string[] {
  if (!ports.includes('modelEngine')) return [];
  return tree.paths
    .filter((path) => engineTurn.test(path))
    .filter((file) => {
      const directory = file.slice(0, file.lastIndexOf('/') + 1);
      const tests = directlyIn(tree, directory).filter((path) => contractTest.test(path));
      return !tests.some((test) => runsAdapter(tree.read(test), file, 'modelEngine'));
    })
    .map((file) => `${file}: no contract test beside it runs it against the modelEngine contract`);
}

export function portContractViolations(ports: readonly string[], tree: SourceTree): string[] {
  return [
    ...suiteViolations(ports, tree),
    ...adapterRoots.flatMap((root) => rootViolations(ports, tree, root)),
    ...engineTurnViolations(ports, tree),
  ];
}
