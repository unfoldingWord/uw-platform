export type FencedMessage = { readonly note: string; readonly quotes: readonly string[] };

const QUOTES_MOST = 20;
const QUOTE_OPEN = /^\s{0,3}(`{3,}|~{3,})\s*quote\s*$/i;
const QUOTE_LINE = /^\s{0,3}> ?(.*)$/;

type Scan = {
  readonly note: string[];
  readonly quotes: string[];
  run: string[] | null;
  fence: string | null;
  fenced: string[];
};

function closesFence(line: string, fence: string): boolean {
  const trimmed = line.trim();
  const mark = fence.charAt(0);
  return trimmed.length >= fence.length && [...trimmed].every((char) => char === mark);
}

function endRun(scan: Scan): void {
  if (scan.run !== null) scan.quotes.push(scan.run.join('\n'));
  scan.run = null;
}

function inFence(scan: Scan, line: string, fence: string): void {
  if (!closesFence(line, fence)) {
    scan.fenced.push(line);
    return;
  }
  scan.quotes.push(scan.fenced.join('\n'));
  scan.fenced = [];
  scan.fence = null;
}

function step(scan: Scan, line: string): void {
  if (scan.fence !== null) return inFence(scan, line, scan.fence);
  const opened = QUOTE_OPEN.exec(line);
  if (opened?.[1] !== undefined) {
    endRun(scan);
    scan.fence = opened[1];
    return;
  }
  const quoted = QUOTE_LINE.exec(line);
  if (quoted !== null) {
    scan.run = [...(scan.run ?? []), quoted[1] ?? ''];
    return;
  }
  endRun(scan);
  scan.note.push(line);
}

function capped(quotes: readonly string[]): readonly string[] {
  const kept = quotes.map((quote) => quote.trim()).filter((quote) => quote.length > 0);
  if (kept.length <= QUOTES_MOST) return kept;
  return [...kept.slice(0, QUOTES_MOST - 1), kept.slice(QUOTES_MOST - 1).join('\n\n')];
}

export function fenceQuotes(content: string): FencedMessage {
  const scan: Scan = { note: [], quotes: [], run: null, fence: null, fenced: [] };
  for (const line of content.split('\n')) step(scan, line);
  endRun(scan);
  if (scan.fence !== null) scan.quotes.push(scan.fenced.join('\n'));
  return { note: scan.note.join('\n').trim(), quotes: capped(scan.quotes) };
}
