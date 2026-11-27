type Reading = { rows: string[][]; row: string[]; cell: string; quoted: boolean };

function endCell(state: Reading): void {
  state.row.push(state.cell);
  state.cell = '';
}

function endRow(state: Reading): void {
  endCell(state);
  state.rows.push(state.row);
  state.row = [];
}

function step(state: Reading, char: string, next: string): number {
  if (state.quoted && char === '"' && next === '"') {
    state.cell += '"';
    return 2;
  }
  if (char === '"') state.quoted = !state.quoted;
  else if (state.quoted) state.cell += char;
  else if (char === ',') endCell(state);
  else if (char === '\n') endRow(state);
  else state.cell += char;
  return 1;
}

export function csvRows(text: string): string[][] {
  const state: Reading = { rows: [], row: [], cell: '', quoted: false };
  for (let at = 0; at < text.length;) at += step(state, text.charAt(at), text.charAt(at + 1));
  endRow(state);
  return state.rows;
}
