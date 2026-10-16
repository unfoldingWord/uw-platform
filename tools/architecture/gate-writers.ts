import { importsOf, type SourceFiles } from './agent-boundary.ts';

export type WriteSite = { readonly file: string; readonly fn: string };

export const PERSON_WRITER: WriteSite = {
  file: 'packages/harness/gates/decide.ts',
  fn: 'recordDecision',
};
export const DELEGATED_WRITER: WriteSite = {
  file: 'packages/harness/gates/delegated-ship.ts',
  fn: 'recordDelegatedDecision',
};

const scannedRoots = ['apps/', 'packages/', 'sim/'];
const unscannedRoots = ['packages/db/', 'packages/harness/port-contracts/'];
const agentSeeds = ['packages/harness/items/', 'packages/harness/runs/', 'packages/harness/reads/'];
const sourceFile = /\.(?:tsx?|m?js)$/;
const testFile = /\.test\.(?:tsx?|m?js)$/;

const writes = [
  /\bgateDecisions\s*\??\.\s*write\b/g,
  /\bgateDecisions\s*\??\.?\s*\[\s*['"`]write['"`]\s*\]/g,
  /\.insert\(\s*[\w.]*\bgateDecisions\b/g,
  /\bINSERT\s+INTO\s+"?gate_decisions"?/gi,
  /\{[^{}]*\bwrite\b[^{}]*\}\s*=\s*[\w.?]*\bgateDecisions\b/g,
  /=\s*[\w.?]*\bgateDecisions\s*[;,)\n]/g,
];
const declarations = /^(?:export )?(?:async )?function\s+(\w+)|^(?:export )?const\s+(\w+)\s*[=:]/gm;

function scanned(file: string): boolean {
  return (
    scannedRoots.some((root) => file.startsWith(root)) &&
    !unscannedRoots.some((root) => file.startsWith(root)) &&
    sourceFile.test(file) &&
    !testFile.test(file) &&
    !file.includes('node_modules/')
  );
}

function enclosing(text: string, index: number): string {
  let name = '<module>';
  for (const match of text.matchAll(declarations)) {
    if (match.index > index) break;
    name = match[1] ?? match[2] ?? name;
  }
  return name;
}

function sitesIn(file: string, text: string): WriteSite[] {
  const found = writes.flatMap((pattern) =>
    [...text.matchAll(pattern)].map((match) => match.index),
  );
  return [...new Set(found.map((index) => enclosing(text, index)))].map((fn) => ({ file, fn }));
}

const keyOf = (site: WriteSite) => `${site.file}#${site.fn}`;

export function gateWriteSites(sources: SourceFiles): WriteSite[] {
  return sources.files
    .filter(scanned)
    .flatMap((file) => sitesIn(file, sources.read(file)))
    .sort((left, right) => keyOf(left).localeCompare(keyOf(right)));
}

export function agentKernelClosure(sources: SourceFiles): string[] {
  const known = new Set(
    sources.files.filter((file) => file.startsWith('packages/harness/') && scanned(file)),
  );
  const pending = [...known].filter((file) => agentSeeds.some((seed) => file.startsWith(seed)));
  const reached = new Set(pending);
  for (let file = pending.pop(); file !== undefined; file = pending.pop()) {
    for (const target of importsOf(file, sources.read(file))) {
      if (known.has(target) && !reached.has(target)) {
        reached.add(target);
        pending.push(target);
      }
    }
  }
  return [...reached].sort();
}

const same = (left: WriteSite, right: WriteSite) => keyOf(left) === keyOf(right);

export function gateWriteViolations(sources: SourceFiles): string[] {
  const sites = gateWriteSites(sources);
  const closure = new Set(agentKernelClosure(sources));
  const stray = sites
    .filter((site) => !same(site, PERSON_WRITER) && !same(site, DELEGATED_WRITER))
    .map((site) => `${site.file} writes gate_decisions in ${site.fn}`);
  const reached = sites
    .filter((site) => closure.has(site.file) && !same(site, DELEGATED_WRITER))
    .map((site) => `an agent verb reaches the gate_decisions write in ${keyOf(site)}`);
  const person = closure.has(PERSON_WRITER.file)
    ? [`an agent verb reaches ${PERSON_WRITER.file}`]
    : [];
  return [...stray, ...reached, ...person];
}
