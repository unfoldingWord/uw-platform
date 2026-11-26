export type Sections<T extends string> = {
  readonly sections: Readonly<Partial<Record<T, string>>>;
  readonly missing: readonly T[];
};

const OPENING_FENCE = /^ {0,3}(`{3,}|~{3,})/;
const SECTION_HEADING = /^ {0,3}##\s+(.+?)\s*#*\s*$/;

type Heading = { readonly title: string; readonly line: number };

type Fence = { readonly mark: string; readonly length: number };

const CLOSING_FENCE = /^ {0,3}(`{3,}|~{3,})\s*$/;

function closes(line: string, fence: Fence): boolean {
  const run = CLOSING_FENCE.exec(line)?.[1];
  return run !== undefined && run.charAt(0) === fence.mark && run.length >= fence.length;
}

function opens(line: string): Fence | null {
  const run = OPENING_FENCE.exec(line)?.[1];
  if (run === undefined) return null;
  const mark = run.charAt(0);
  if (mark === '`' && line.slice(line.indexOf(run) + run.length).includes('`')) return null;
  return { mark, length: run.length };
}

function headingsOf(lines: readonly string[]): readonly Heading[] {
  const found: Heading[] = [];
  let fence: Fence | null = null;
  lines.forEach((line, index) => {
    if (fence !== null) {
      if (closes(line, fence)) fence = null;
      return;
    }
    fence = opens(line);
    const match = fence === null ? SECTION_HEADING.exec(line) : null;
    if (match?.[1] !== undefined) found.push({ title: match[1].toLowerCase(), line: index });
  });
  return found;
}

function textUnder(lines: readonly string[], headings: readonly Heading[], at: number): string {
  const start = (headings.at(at)?.line ?? 0) + 1;
  const end = headings.at(at + 1)?.line ?? lines.length;
  return lines.slice(start, end).join('\n').trim();
}

function longestInOrder(
  wanted: readonly string[],
  found: readonly Heading[],
): ReadonlyMap<number, number> {
  const rows = wanted.length + 1;
  const columns = found.length + 1;
  const best = new Int32Array(rows * columns);
  const cell = (row: number, column: number) => best.at(row * columns + column) ?? 0;
  for (let row = wanted.length - 1; row >= 0; row -= 1) {
    for (let column = found.length - 1; column >= 0; column -= 1) {
      const same = found.at(column)?.title === wanted.at(row);
      const value = same
        ? cell(row + 1, column + 1) + 1
        : Math.max(cell(row + 1, column), cell(row, column + 1));
      best.set([value], row * columns + column);
    }
  }
  const matched = new Map<number, number>();
  let [row, column] = [0, 0];
  while (row < wanted.length && column < found.length) {
    if (found.at(column)?.title === wanted.at(row)) {
      matched.set(row, column);
      [row, column] = [row + 1, column + 1];
    } else if (cell(row + 1, column) >= cell(row, column + 1)) row += 1;
    else column += 1;
  }
  return matched;
}

export function sectionsIn<T extends string>(bodyMd: string, order: readonly T[]): Sections<T> {
  const lines = bodyMd.split(/\r?\n/);
  const headings = headingsOf(lines);
  const matched = longestInOrder(
    order.map((section) => section.toLowerCase()),
    headings,
  );
  const sections = new Map<T, string>();
  const missing: T[] = [];
  order.forEach((section, index) => {
    const at = matched.get(index);
    if (at === undefined) missing.push(section);
    else sections.set(section, textUnder(lines, headings, at));
  });
  return { sections: Object.fromEntries(sections) as Partial<Record<T, string>>, missing };
}
