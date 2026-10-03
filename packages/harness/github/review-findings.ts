import { parseReviewProvider } from './declaration.ts';
import { FINDING_LIMIT, FINDINGS_LIMIT, cut, oneLine } from './review-body.ts';

const closingFence = '```';
const findingMark = '- ';

export function parseReviewFindings(body: string | null): readonly string[] {
  if (body === null || parseReviewProvider(body) === null) return [];
  const lines = body.split(/\r?\n/u);
  const end = lines.indexOf(closingFence, 1);
  return lines
    .slice(end + 1)
    .filter((line) => line.startsWith(findingMark))
    .map((line) => cut(oneLine(line.slice(findingMark.length)), FINDING_LIMIT))
    .filter((finding) => finding !== '')
    .slice(0, FINDINGS_LIMIT);
}
