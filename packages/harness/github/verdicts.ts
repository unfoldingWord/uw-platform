import { reviewVerdictSchema, type ReviewVerdict } from '@uw/contracts';
import { readFields, type DeclarationProblem } from './declaration.ts';
import { fencedBlock } from './fenced-block.ts';

type VerdictProblem = DeclarationProblem;

type VerdictParse<T> =
  | { readonly ok: true; readonly verdict: T }
  | { readonly ok: false; readonly problem: VerdictProblem };

type ScoutVerdict = { readonly premise: 'holds' | 'held'; readonly reason: string };
type ReviewVerdictRead = {
  readonly verdict: ReviewVerdict;
  readonly findings: readonly string[];
};

const REASON_LIMIT = 200;
const FINDING_LIMIT = 500;
const FINDINGS_LIMIT = 50;
const findingMark = '- ';
const premises: ReadonlySet<string> = new Set(['holds', 'held']);

function problem(found: VerdictProblem): { readonly ok: false; readonly problem: VerdictProblem } {
  return { ok: false, problem: found };
}

type Block = { readonly fields: ReadonlyMap<string, string>; readonly after: readonly string[] };

function readBlock(
  text: string | null,
  label: string,
  keys: readonly string[],
): Block | VerdictProblem {
  const block = fencedBlock(text, label, keys);
  if (!block.ok) return block.problem;
  const fields = readFields(block.lines);
  if (!fields.ok) return fields.problem;
  if ([...fields.value.keys()].some((key) => !keys.includes(key))) return 'unknown_key';
  if (keys.some((key) => !fields.value.has(key))) return 'missing_key';
  const after = (text ?? '').split(/\r?\n/u).slice(block.lines.length + 2);
  return { fields: fields.value, after };
}

function withinLimit(value: string, limit: number): boolean {
  return value.length >= 1 && value.length <= limit;
}

export function parseScoutVerdict(text: string | null): VerdictParse<ScoutVerdict> {
  const block = readBlock(text, 'harness-scout', ['premise', 'reason']);
  if (typeof block === 'string') return problem(block);
  const premise = block.fields.get('premise') ?? '';
  const reason = block.fields.get('reason') ?? '';
  if (!premises.has(premise) || !withinLimit(reason, REASON_LIMIT)) {
    return problem('invalid_value');
  }
  return { ok: true, verdict: { premise: premise === 'holds' ? 'holds' : 'held', reason } };
}

function findingsOf(after: readonly string[]): readonly string[] | null {
  const findings = after
    .filter((line) => line.startsWith(findingMark))
    .map((line) => line.slice(findingMark.length).trim());
  if (findings.length > FINDINGS_LIMIT) return null;
  return findings.every((finding) => withinLimit(finding, FINDING_LIMIT)) ? findings : null;
}

export function parseReviewVerdict(text: string | null): VerdictParse<ReviewVerdictRead> {
  const block = readBlock(text, 'harness-verdict', ['verdict']);
  if (typeof block === 'string') return problem(block);
  const verdict = reviewVerdictSchema.safeParse(block.fields.get('verdict'));
  const findings = findingsOf(block.after);
  if (!verdict.success || findings === null) return problem('invalid_value');
  return { ok: true, verdict: { verdict: verdict.data, findings } };
}
