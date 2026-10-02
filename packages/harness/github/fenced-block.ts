export type BlockProblem = 'missing' | 'too_long' | 'ambiguous_block' | 'unclosed_block';

export type BlockRead =
  | { readonly ok: true; readonly lines: readonly string[] }
  | { readonly ok: false; readonly problem: BlockProblem };

type Fence = { readonly char: string; readonly length: number };

type Scan = { readonly candidates: readonly number[]; readonly nested: boolean };

const maxBodyLength = 65_536;
const closingFence = '```';
const fenceLine = /^(`{3,}|~{3,})(.*)$/u;
const formatCharacters = /\p{Cf}/gu;
const nonAscii = /[^\x20-\x7e]/u;

function refused(problem: BlockProblem): BlockRead {
  return { ok: false, problem };
}

function detectionForm(line: string): string {
  return line.normalize('NFKC').replace(formatCharacters, '').trimStart();
}

function isCandidateInfo(info: string): boolean {
  return info.toLowerCase().includes('harness') || nonAscii.test(info);
}

function closes(open: Fence, run: string, info: string): boolean {
  return run.startsWith(open.char) && run.length >= open.length && info.trim() === '';
}

function scanFences(detected: readonly string[]): Scan {
  const candidates: number[] = [];
  let nested = false;
  let open: Fence | null = null;
  for (const [index, line] of detected.entries()) {
    const match = fenceLine.exec(line);
    const run = match?.[1];
    const info = match?.[2] ?? '';
    if (run === undefined) continue;
    const candidate = isCandidateInfo(info);
    if (candidate) candidates.push(index);
    if (open === null) open = { char: run.charAt(0), length: run.length };
    else if (closes(open, run, info)) open = null;
    else if (candidate) nested = true;
  }
  return { candidates, nested };
}

function isKeyLine(line: string, keys: readonly string[]): boolean {
  const lowered = line.toLowerCase();
  return keys.some(
    (key) => lowered.startsWith(key) && lowered.slice(key.length).trimStart().startsWith(':'),
  );
}

function keyOutside(
  detected: readonly string[],
  keys: readonly string[],
  [start, end]: readonly [number, number],
): boolean {
  return detected.some((line, index) => (index <= start || index >= end) && isKeyLine(line, keys));
}

function soleBlock(raw: readonly string[], opening: string, keys: readonly string[]): BlockRead {
  const detected = raw.map(detectionForm);
  const { candidates, nested } = scanFences(detected);
  const [start] = candidates;
  if (start === undefined) return refused('missing');
  if (nested || candidates.length > 1 || raw.at(start) !== opening)
    return refused('ambiguous_block');
  const end = raw.indexOf(closingFence, start + 1);
  if (end === -1) return refused('unclosed_block');
  if (keyOutside(detected, keys, [start, end])) return refused('ambiguous_block');
  return { ok: true, lines: raw.slice(start + 1, end) };
}

export function fencedBlock(body: unknown, info: string, keys: readonly string[]): BlockRead {
  if (typeof body !== 'string') return refused('missing');
  if (body.length > maxBodyLength) return refused('too_long');
  if (body.includes('<!--')) return refused('ambiguous_block');
  const raw = body.split(/\r?\n/u).map((line) => line.trimEnd());
  return soleBlock(raw, `${closingFence}${info}`, keys);
}
