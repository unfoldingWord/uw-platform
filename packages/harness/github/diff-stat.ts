export type DiffStat = { readonly lines: number; readonly paths: readonly string[] };

type Tally = { lines: number; inHunk: boolean; readonly paths: Set<string> };

const HEADER = 'diff --git ';
const fileHeader = /^diff --git a\/(\S+) b\/(\S+)$/u;
const binaryEntry = /^Binary files .+ differ$/u;

function tallied(tally: Tally, line: string): boolean {
  if (line.startsWith(HEADER)) {
    const header = fileHeader.exec(line);
    if (header === null) return false;
    for (const path of header.slice(1)) tally.paths.add(path);
    tally.inHunk = false;
  } else if (line.startsWith('@@')) {
    tally.inHunk = true;
  } else if (binaryEntry.test(line)) {
    tally.lines += 1;
  } else if (tally.inHunk && (line.startsWith('+') || line.startsWith('-'))) {
    tally.lines += 1;
  }
  return true;
}

export function diffStat(text: string): DiffStat | null {
  const tally: Tally = { lines: 0, inHunk: false, paths: new Set<string>() };
  for (const line of text.split('\n')) {
    if (!tallied(tally, line)) return null;
  }
  return { lines: tally.lines, paths: [...tally.paths] };
}
