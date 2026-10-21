import type { ClosingRef } from '@uw/contracts';

const owner = '[A-Za-z0-9-]{1,39}\\/[A-Za-z0-9._-]{1,100}';
const reference = new RegExp(
  `\\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\\b\\s*:?\\s*(?:https:\\/\\/github\\.com\\/(${owner})\\/issues\\/|(${owner})#|#)([1-9][0-9]{0,9})\\b`,
  'giu',
);
const skipMarker =
  /\[(?:skip ci|ci skip|no ci|skip actions|actions skip)\]|^skip-checks:\s*true\s*$/imu;
const REFERENCE_LIMIT = 100;

function sameRef(left: ClosingRef, right: ClosingRef): boolean {
  return left.number === right.number && left.repo.toLowerCase() === right.repo.toLowerCase();
}

export function closingReferences(text: string | null, repository: string): readonly ClosingRef[] {
  if (text === null) return [];
  const found: ClosingRef[] = [];
  for (const match of text.matchAll(reference)) {
    const ref = { repo: match[1] ?? match[2] ?? repository, number: Number(match[3] ?? '0') };
    if (ref.number > 0 && !found.some((seen) => sameRef(seen, ref))) found.push(ref);
    if (found.length === REFERENCE_LIMIT) break;
  }
  return found;
}

export function hasSkipCiMarker(message: string): boolean {
  return skipMarker.test(message);
}
