import type { AppDeps } from '../deps.ts';

export function recordingDeps() {
  const lines: Record<string, unknown>[] = [];
  const deps: AppDeps = {
    openDatabase: () => null,
    accessKeys: () => async () => {
      throw new Error('no Access keys in this test');
    },
    newId: () => crypto.randomUUID(),
    sink: (line) => lines.push(JSON.parse(line)),
  };
  return { deps, lines };
}
