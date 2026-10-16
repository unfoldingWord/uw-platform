import type { PullRequestDeclaration } from '@uw/contracts';
import type { DiffStat } from '../github/diff-stat.ts';
import type { FixContext, ValidationContext } from './context.ts';

const QUARTERS = 4;
const NAMED_PATHS = 5;
const testName = /\.(?:test|spec)\.[a-z]+$/u;
const releaseNotes = /^(?:README|CHANGELOG)/u;
const testDirectories: ReadonlySet<string> = new Set(['__tests__', 'test', 'tests']);
const guardedDirectories: ReadonlySet<string> = new Set([
  '.claude',
  '.github',
  'skills',
  'personas',
  'persona',
]);
const guardedNames: ReadonlySet<string> = new Set(['AGENTS.md', 'CLAUDE.md', 'SKILL.md']);
const PACKAGE_DEPTH = 2;

function guarded(segments: readonly string[], name: string): boolean {
  return (
    guardedNames.has(name) || segments.slice(0, -1).some((part) => guardedDirectories.has(part))
  );
}

function underTests(segments: readonly string[], depth: number): boolean {
  return segments.length > depth + 1 && testDirectories.has(segments.at(depth) ?? '');
}

function testFile(segments: readonly string[], name: string): boolean {
  return testName.test(name) || underTests(segments, 0) || underTests(segments, PACKAGE_DEPTH);
}

function docFile(segments: readonly string[], name: string): boolean {
  return (segments[0] === 'docs' && name.endsWith('.md')) || releaseNotes.test(name);
}

export function testOrDoc(path: string): boolean {
  const segments = path.split('/');
  const name = segments.at(-1) ?? '';
  if (guarded(segments, name)) return false;
  return testFile(segments, name) || docFile(segments, name);
}

function outside(pull: DiffStat, fix: DiffStat): readonly string[] {
  const touched = new Set(pull.paths);
  return fix.paths.filter((path) => !touched.has(path) && !testOrDoc(path));
}

function sizeFailures(fix: FixContext): readonly string[] {
  if (fix.pull === null || fix.fix === null) {
    return ['fix_size_cap: the fix could not be measured against the pull request'];
  }
  const { pull } = fix;
  if (fix.fix.paths.length === 0) return ['fix_size_cap: the fix changes nothing'];
  const lines = fix.fix.lines;
  const over =
    lines * QUARTERS > pull.lines
      ? [
          `fix_size_cap: the fix changes ${lines.toString()} lines, more than a quarter of the pull request's ${pull.lines.toString()}`,
        ]
      : [];
  const strays = outside(pull, fix.fix)
    .slice(0, NAMED_PATHS)
    .map((path) => `fix_size_cap: the fix touches ${path}, which the pull request does not`);
  return [...over, ...strays];
}

export function fixSizeCap(context: ValidationContext): readonly string[] {
  return context.fix === undefined || context.fix === null ? [] : sizeFailures(context.fix);
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  const seen = new Set(left);
  return seen.size === new Set(right).size && right.every((value) => seen.has(value));
}

function sameText(left: PullRequestDeclaration, right: PullRequestDeclaration): boolean {
  return (
    left.risks === right.risks && left.touches === right.touches && left.riskTier === right.riskTier
  );
}

export function sameDeclaration(
  left: PullRequestDeclaration | null,
  right: PullRequestDeclaration | null,
): boolean {
  if (left === null || right === null) return left === right;
  return (
    sameText(left, right) &&
    sameSet(left.closes, right.closes) &&
    sameSet(left.riskDomains, right.riskDomains)
  );
}

export function fixKeepsPurpose(context: ValidationContext): readonly string[] {
  const { fix } = context;
  if (fix === undefined || fix === null) return [];
  if (!fix.samePullRequest) {
    return ["fix_keeps_purpose: the fix names a pull request other than the item's"];
  }
  if (!fix.claimed) return ['fix_keeps_purpose: the fix claim recorded no declaration'];
  return sameDeclaration(fix.declared, fix.declaration)
    ? []
    : ['fix_keeps_purpose: the pull request declaration changed since the fix was claimed'];
}
