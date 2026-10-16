import type { PullRequestDeclaration } from '@uw/contracts';
import type { DiffStat } from '../github/diff-stat.ts';
import type { FixContext, ValidationContext } from './context.ts';

const QUARTERS = 4;
const NAMED_PATHS = 5;
const testPath = /(?:^|\/)(?:test|tests|__tests__|spec)\/|\.(?:test|spec)\.[a-z]+$/u;
const docPath = /^docs\/|\.md$/u;

export function testOrDoc(path: string): boolean {
  return testPath.test(path) || docPath.test(path);
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
  if (!fix.claimed) return ['fix_keeps_purpose: the fix claim recorded no declaration'];
  return sameDeclaration(fix.declared, fix.declaration)
    ? []
    : ['fix_keeps_purpose: the pull request declaration changed since the fix was claimed'];
}
