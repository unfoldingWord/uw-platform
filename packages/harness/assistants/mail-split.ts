export type SplitMail = { readonly note: string; readonly forwarded: readonly string[] };

const MARKERS: readonly RegExp[] = [
  /^-{2,}\s*\S.*\S\s*-{2,}\s*$/u,
  /^_{8,}\s*$/,
  /^Begin forwarded message:\s*$/i,
  /^On .+ wrote:\s*$/,
  /<[^\s<>@]+@[^\s<>@]+>.*:\s*$/,
];
const FIELD = /^[\p{L}][\p{L} .'-]{0,24}?\s?:\s*\S/u;
const ADDRESS = /[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+/;
const QUOTED = /^\s*>/;
const OUTLOOK_FROM = /^From:\s.+/;
const OUTLOOK_NEXT = /^(Sent|Date):\s/;
const FIELDS_WITH_ADDRESS = 2;
const FIELDS_ALONE = 4;

function fieldRun(lines: readonly string[], index: number): readonly string[] {
  const run: string[] = [];
  for (const line of lines.slice(index)) {
    if (!FIELD.test(line.trim())) break;
    run.push(line);
  }
  return run;
}

function outlookHeader(lines: readonly string[], index: number): boolean {
  const line = lines.at(index) ?? '';
  if (!OUTLOOK_FROM.test(line) || index === 0) return false;
  return lines.slice(index + 1, index + 4).some((next) => OUTLOOK_NEXT.test(next));
}

function headerBlock(lines: readonly string[], index: number): boolean {
  if (outlookHeader(lines, index)) return true;
  const run = fieldRun(lines, index);
  if (run.length >= FIELDS_ALONE) return true;
  return run.length >= FIELDS_WITH_ADDRESS && run.some((line) => ADDRESS.test(line));
}

function markerAt(lines: readonly string[]): number {
  return lines.findIndex(
    (line, index) =>
      MARKERS.some((marker) => marker.test(line.trim())) || headerBlock(lines, index),
  );
}

function fenceQuoted(lines: readonly string[]): SplitMail {
  const kept: string[] = [];
  const runs: string[][] = [];
  let run: string[] | null = null;
  for (const line of lines) {
    if (QUOTED.test(line)) {
      if (run === null) {
        run = [];
        runs.push(run);
      }
      run.push(line);
      continue;
    }
    run = null;
    kept.push(line);
  }
  const forwarded = runs.map((each) => each.join('\n').trim()).filter((text) => text !== '');
  return { note: kept.join('\n').trim(), forwarded };
}

export function splitForward(text: string): SplitMail {
  const lines = text.replaceAll('\r\n', '\n').split('\n');
  const at = markerAt(lines);
  const mine = at === -1 ? lines : lines.slice(0, at);
  const own = fenceQuoted(mine);
  if (at === -1) return own;
  const original = lines.slice(at).join('\n').trim();
  return { note: own.note, forwarded: [...own.forwarded, original] };
}
