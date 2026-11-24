export type LineChange = {
  readonly kind: 'same' | 'added' | 'removed';
  readonly text: string;
};

const MOST_CELLS = 4_000_000;

function linesOf(text: string): string[] {
  return text === '' ? [] : text.split('\n');
}

function commonLengths(before: readonly string[], after: readonly string[]): Uint32Array[] {
  const table = Array.from({ length: before.length + 1 }, () => new Uint32Array(after.length + 1));
  for (let row = before.length - 1; row >= 0; row -= 1) {
    const here = table.at(row);
    const below = table.at(row + 1);
    if (here === undefined || below === undefined) continue;
    for (let column = after.length - 1; column >= 0; column -= 1) {
      const longest =
        before.at(row) === after.at(column)
          ? (below.at(column + 1) ?? 0) + 1
          : Math.max(below.at(column) ?? 0, here.at(column + 1) ?? 0);
      here.set([longest], column);
    }
  }
  return table;
}

type Walk = { row: number; column: number };

function step(
  walk: Walk,
  lines: { readonly left: string; readonly right: string },
  table: readonly Uint32Array[],
): LineChange {
  const { left, right } = lines;
  if (left === right) {
    walk.row += 1;
    walk.column += 1;
    return { kind: 'same', text: left };
  }
  const skipLeft = table.at(walk.row + 1)?.at(walk.column) ?? 0;
  const skipRight = table.at(walk.row)?.at(walk.column + 1) ?? 0;
  if (skipLeft >= skipRight) {
    walk.row += 1;
    return { kind: 'removed', text: left };
  }
  walk.column += 1;
  return { kind: 'added', text: right };
}

export function lineChanges(beforeText: string, afterText: string): LineChange[] | null {
  const before = linesOf(beforeText);
  const after = linesOf(afterText);
  if ((before.length + 1) * (after.length + 1) > MOST_CELLS) return null;
  const table = commonLengths(before, after);
  const changes: LineChange[] = [];
  const walk: Walk = { row: 0, column: 0 };
  while (walk.row < before.length && walk.column < after.length) {
    const lines = { left: before.at(walk.row) ?? '', right: after.at(walk.column) ?? '' };
    changes.push(step(walk, lines, table));
  }
  for (const text of before.slice(walk.row)) changes.push({ kind: 'removed', text });
  for (const text of after.slice(walk.column)) changes.push({ kind: 'added', text });
  return changes;
}
