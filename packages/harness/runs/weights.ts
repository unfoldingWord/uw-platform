import type {
  ApproveAt,
  FindingWeight,
  ReadFinding,
  ReviewFinding,
  ReviewRecord,
  ReviewVerdict,
} from '@uw/contracts';

const FINDING_LIMIT = 500;
const FINDINGS_LIMIT = 50;

const counted: ReadonlySet<FindingWeight> = new Set<FindingWeight>(['real', 'plausible']);
const blocking: ReadonlyMap<ApproveAt, ReadonlySet<FindingWeight>> = new Map([
  ['zero_findings', new Set<FindingWeight>(['real', 'plausible', 'theoretical'])],
  ['no_real_or_plausible', counted],
]);

export function weighedFindings(drafts: readonly ReadFinding[]): readonly ReviewFinding[] | null {
  const findings: ReviewFinding[] = [];
  for (const draft of drafts.slice(0, FINDINGS_LIMIT)) {
    if (draft.weight === null) return null;
    const text = draft.text.trim().slice(0, FINDING_LIMIT);
    if (text !== '') findings.push({ text, weight: draft.weight });
  }
  return findings;
}

export function postedVerdict(
  approveAt: ApproveAt,
  findings: readonly ReviewFinding[],
): ReviewVerdict {
  const blocks = blocking.get(approveAt) ?? counted;
  return findings.some((finding) => blocks.has(finding.weight)) ? 'request_changes' : 'approve';
}

export function countsAsRound(review: ReviewRecord): boolean {
  return (
    review.verdict === 'request_changes' &&
    review.findings.some((finding) => counted.has(finding.weight))
  );
}
