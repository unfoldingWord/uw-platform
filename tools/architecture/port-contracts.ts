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

function suiteViolations(ports: readonly string[], tree: SourceTree): string[] {
  return ports.flatMap((port) => {
    const path = `${contractRoot}${kebab(port)}.ts`;
    if (!tree.paths.includes(path)) return [`${port}: no contract suite at ${path}`];
    const exported = tree.read(path).includes(`export function ${suiteName(port)}(`);
    return exported ? [] : [`${port}: ${path} does not export ${suiteName(port)}`];
  });
}

function runsAdapter(source: string, file: string, port: string): boolean {
  const base = file.slice(file.lastIndexOf('/') + 1);
  return (
    source.includes(`from './${base}'`) &&
    source.includes(`from '@uw/harness/port-contracts/${kebab(port)}'`)
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

export function portContractViolations(ports: readonly string[], tree: SourceTree): string[] {
  return [
    ...suiteViolations(ports, tree),
    ...adapterRoots.flatMap((root) => rootViolations(ports, tree, root)),
  ];
}
