import { importsOf, personSurface, type SourceFiles } from './agent-boundary.ts';
import type { WriteSite } from './gate-writers.ts';

const DECIDER: WriteSite = {
  file: 'packages/harness/assistants/proposal-decide.ts',
  fn: 'decidedIn',
};
const KERNEL_COMMANDS = 'packages/harness/assistants/commands.ts';

const scannedRoots = ['apps/', 'packages/', 'sim/'];
const unscannedRoots = ['packages/db/', 'packages/harness/port-contracts/', 'sim/'];
const turnSeeds = [
  'packages/harness/assistants/proposal-drafts.ts',
  'packages/harness/assistants/reminder-drafts.ts',
  'packages/harness/assistants/calendar-drafts.ts',
  'packages/harness/assistants/calendar-reads.ts',
  'packages/harness/assistants/turn.ts',
  'packages/harness/assistants/finish.ts',
];
const sourceFile = /\.(?:tsx?|m?js)$/;
const testFile = /\.test\.(?:tsx?|m?js)$/;

const decisions = [
  /\bassistantProposals\s*\??\.\s*write\s*\??\.\s*decide\b/g,
  /\.update\(\s*[\w.]*\bassistantProposals\b[^;]*\bdecidedBy\b/g,
  /\bUPDATE\s+"?assistant_proposals"?[^;`]*\bdecided_by\b/gi,
];
const decideCall = /\bdecideProposal\s*\(/;
const declarations =
  /^(?:export )?(?:async )?function\s+(\w+)|^(?:export )?const\s+(\w+)\s*[=:]|^(?:export )?(?:default )?(?:let|var|class|function|async)\b/gm;

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
    name = match[1] ?? match[2] ?? '<module>';
  }
  return name;
}

function sitesIn(file: string, text: string): WriteSite[] {
  const found = decisions.flatMap((pattern) =>
    [...text.matchAll(pattern)].map((match) => match.index),
  );
  return [...new Set(found.map((index) => enclosing(text, index)))].map((fn) => ({ file, fn }));
}

const keyOf = (site: WriteSite) => `${site.file}#${site.fn}`;

export function proposalDecisionSites(sources: SourceFiles): WriteSite[] {
  return sources.files
    .filter(scanned)
    .flatMap((file) => sitesIn(file, sources.read(file)))
    .sort((left, right) => keyOf(left).localeCompare(keyOf(right)));
}

export function decideCallSites(sources: SourceFiles): string[] {
  return sources.files
    .filter((file) => scanned(file) && file.startsWith('apps/'))
    .filter((file) => decideCall.test(sources.read(file)))
    .sort();
}

export function turnKernelClosure(sources: SourceFiles): string[] {
  const known = new Set(
    sources.files.filter((file) => file.startsWith('packages/harness/') && scanned(file)),
  );
  const pending = turnSeeds.filter((file) => known.has(file));
  const reached = new Set(pending);
  for (let file = pending.pop(); file !== undefined; file = pending.pop()) {
    for (const target of importsOf(file, sources.read(file))) {
      if (known.has(target) && !reached.has(target) && target !== KERNEL_COMMANDS) {
        reached.add(target);
        pending.push(target);
      }
    }
  }
  return [...reached].sort();
}

export function proposalDecisionViolations(sources: SourceFiles): string[] {
  const stray = proposalDecisionSites(sources)
    .filter((site) => keyOf(site) !== keyOf(DECIDER))
    .map((site) => `${site.file} decides a proposal in ${site.fn}`);
  const callers = decideCallSites(sources)
    .filter((file) => !file.startsWith(personSurface))
    .map((file) => `${file} asks the kernel to decide a proposal`);
  const reached = turnKernelClosure(sources).includes(DECIDER.file)
    ? [`an assistant turn reaches ${DECIDER.file}`]
    : [];
  return [...stray, ...callers, ...reached];
}
