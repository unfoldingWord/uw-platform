const stepRow = /^\| (\d+)\. [^|]*\| [^|]*\| ([^|]*?) \|/;
const doneStates: ReadonlySet<string> = new Set(['built', 'done']);

export function completedSteps(tracker: string): Set<number> {
  const done = tracker.split('\n').flatMap((line) => {
    const match = stepRow.exec(line);
    return match?.[1] && doneStates.has((match[2] ?? '').trim().toLowerCase())
      ? [Number(match[1])]
      : [];
  });
  return new Set(done);
}
