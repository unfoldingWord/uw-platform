export type BlockProblem = 'missing' | 'too_long' | 'ambiguous_block' | 'unclosed_block';

export type BlockRead =
  | { readonly ok: true; readonly lines: readonly string[] }
  | { readonly ok: false; readonly problem: BlockProblem };

const maxBodyLength = 65_536;
const closingFence = '```';
const forbiddenCharacters = /\r(?!\n)|[\u0085\u2028\u2029\f\v\uFEFF]/u;
const forbiddenMarkup: readonly string[] = ['<!', '<?'];
const fenceStart = /^(?:`{3}|~{3})/u;
const fenceRun = /^(?:`{3,}|~{3,})/u;
const formatCharacters = /\p{Cf}/gu;
const nonAscii = /[^\x20-\x7e]/u;
const containerMarks = /^[\s>|#*+-]+/u;
const orderedMarker = /^\d{1,9}[.)]/u;
const markup = /[\s*_`]/gu;

function refused(problem: BlockProblem): BlockRead {
  return { ok: false, problem };
}

function withoutContainers(line: string): string {
  let rest = line;
  let previous = '';
  while (rest !== previous) {
    previous = rest;
    rest = rest.replace(containerMarks, '').replace(orderedMarker, '');
  }
  return rest;
}

function detectionForm(line: string): string {
  return withoutContainers(line.normalize('NFKC').replace(formatCharacters, ''));
}

function isCandidate(line: string): boolean {
  const run = fenceRun.exec(line)?.[0];
  if (run === undefined) return false;
  const info = line.slice(run.length);
  return info.toLowerCase().includes('harness') || nonAscii.test(info);
}

function isKeyLine(line: string, keys: readonly string[]): boolean {
  const squashed = line.toLowerCase().replace(markup, '');
  return keys.some((key) => {
    const name = key.replace(markup, '');
    const next = squashed.charAt(name.length);
    return squashed.startsWith(name) && (next === ':' || next === '|');
  });
}

function closingIndex(raw: readonly string[]): number | 'ambiguous' {
  for (const [index, line] of raw.entries()) {
    if (index === 0) continue;
    if (line === closingFence) return index;
    if (fenceStart.test(line.trim())) return 'ambiguous';
  }
  return -1;
}

function strayAfter(raw: readonly string[], end: number, keys: readonly string[]): boolean {
  return raw
    .slice(end + 1)
    .map(detectionForm)
    .some((line) => isCandidate(line) || isKeyLine(line, keys));
}

function headBlock(raw: readonly string[], opening: string, keys: readonly string[]): BlockRead {
  if (raw.at(0) !== opening) return refused('missing');
  const end = closingIndex(raw);
  if (end === 'ambiguous') return refused('ambiguous_block');
  if (end === -1) return refused('unclosed_block');
  if (strayAfter(raw, end, keys)) return refused('ambiguous_block');
  return { ok: true, lines: raw.slice(1, end).map((line) => line.trimEnd()) };
}

function hasForbidden(body: string): boolean {
  return forbiddenCharacters.test(body) || forbiddenMarkup.some((mark) => body.includes(mark));
}

export function fencedBlock(body: unknown, info: string, keys: readonly string[]): BlockRead {
  if (typeof body !== 'string') return refused('missing');
  if (body.length > maxBodyLength) return refused('too_long');
  if (hasForbidden(body)) return refused('ambiguous_block');
  return headBlock(body.split(/\r?\n/u), `${closingFence}${info}`, keys);
}
