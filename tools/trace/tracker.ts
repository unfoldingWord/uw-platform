const heading = '## Status by build-order step';
const tableLine = /^\|/;
const separator = /^\|[-| ]+\|$/;
const headerRow = /^\| Step \|/;
const stepRow = /^\| (\d+)\.[^|]*\|[^|]*\|([^|]*)\|[^|]*\|$/;
const states: ReadonlySet<string> = new Set(['not started', 'in progress', 'built', 'done']);
const doneStates: ReadonlySet<string> = new Set(['built', 'done']);
const firstStep = 0;

function statusLines(tracker: string): string[] {
  const lines = tracker.split('\n');
  const start = lines.findIndex((line) => line === heading);
  if (start === -1) throw new Error(`the tracker has no "${heading}" section`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith('## '));
  return (end === -1 ? rest : rest.slice(0, end)).filter(
    (line) => tableLine.test(line) && !separator.test(line) && !headerRow.test(line),
  );
}

function readRow(line: string): { step: number; state: string } {
  const match = stepRow.exec(line);
  if (!match?.[1]) throw new Error(`unreadable tracker row: ${line}`);
  const state = (match[2] ?? '').trim().toLowerCase();
  if (!states.has(state))
    throw new Error(`unknown state "${(match[2] ?? '').trim()}" in tracker row: ${line}`);
  return { step: Number(match[1]), state };
}

function checkStepNumbers(rows: readonly { step: number }[], prdSteps: readonly number[]): void {
  const expected = new Set([firstStep, ...prdSteps]);
  const seen = new Set<number>();
  for (const { step } of rows) {
    if (!expected.has(step))
      throw new Error(`tracker has a row for step ${step}, which the PRD does not have`);
    if (seen.has(step)) throw new Error(`tracker has more than one row for step ${step}`);
    seen.add(step);
  }
  for (const step of expected) {
    if (!seen.has(step)) throw new Error(`tracker has no row for step ${step}`);
  }
}

export function completedSteps(tracker: string, prdSteps: readonly number[]): Set<number> {
  const rows = statusLines(tracker).map(readRow);
  checkStepNumbers(rows, prdSteps);
  return new Set(rows.filter((row) => doneStates.has(row.state)).map((row) => row.step));
}
