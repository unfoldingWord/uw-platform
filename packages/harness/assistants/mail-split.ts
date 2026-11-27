export type SplitMail = { readonly note: string; readonly forwarded: readonly string[] };

const MARKERS: readonly RegExp[] = [
  /^-{2,}\s*Forwarded message\s*-{2,}\s*$/i,
  /^Begin forwarded message:\s*$/i,
  /^-{2,}\s*Original Message\s*-{2,}\s*$/i,
  /^On .+ wrote:\s*$/,
];
const OUTLOOK_FROM = /^From:\s.+/;
const OUTLOOK_NEXT = /^(Sent|Date):\s/;
const QUOTED = /^\s*>/;

function outlookHeader(lines: readonly string[], index: number): boolean {
  const line = lines.at(index) ?? '';
  if (!OUTLOOK_FROM.test(line) || index === 0) return false;
  return lines.slice(index + 1, index + 4).some((next) => OUTLOOK_NEXT.test(next));
}

function markerAt(lines: readonly string[]): number {
  return lines.findIndex(
    (line, index) =>
      MARKERS.some((marker) => marker.test(line.trim())) || outlookHeader(lines, index),
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
