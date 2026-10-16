export type DiffStat = { readonly lines: number; readonly paths: readonly string[] };

const fileHeader = /^diff --git a\/(.+) b\/(.+)$/u;

export function diffStat(text: string): DiffStat {
  const paths = new Set<string>();
  let lines = 0;
  let inHunk = false;
  for (const line of text.split('\n')) {
    const header = fileHeader.exec(line);
    if (header !== null) {
      for (const path of header.slice(1)) paths.add(path);
      inHunk = false;
    } else if (line.startsWith('@@')) {
      inHunk = true;
    } else if (inHunk && (line.startsWith('+') || line.startsWith('-'))) {
      lines += 1;
    }
  }
  return { lines, paths: [...paths] };
}
