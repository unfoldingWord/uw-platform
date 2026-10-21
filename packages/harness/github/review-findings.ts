import type { ReadFinding } from '@uw/contracts';
import { parseReviewProvider } from './declaration.ts';
import { weighedLine } from './finding-line.ts';
import { FINDING_LIMIT, FINDINGS_LIMIT, cut, oneLine } from './review-body.ts';

const closingFence = '```';
const findingMark = '- ';

export function parseReviewFindings(body: string | null): readonly ReadFinding[] {
  if (body === null || parseReviewProvider(body) === null) return [];
  const lines = body.split(/\r?\n/u);
  const end = lines.indexOf(closingFence, 1);
  return lines
    .slice(end + 1)
    .filter((line) => line.startsWith(findingMark))
    .map((line) => oneLine(line.slice(findingMark.length)))
    .filter((finding) => finding !== '')
    .slice(0, FINDINGS_LIMIT)
    .map(weighedLine)
    .map((finding) => ({ ...finding, text: cut(finding.text, FINDING_LIMIT) }));
}
