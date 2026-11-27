type ProbeStatus = 'pass' | 'fail' | 'skip' | 'manual';
export type ProbeResult = {
  readonly id: string;
  readonly status: ProbeStatus;
  readonly detail: string;
};

function passed(id: string, detail: string): ProbeResult {
  return { id, status: 'pass', detail };
}

export function failed(id: string, detail: string): ProbeResult {
  return { id, status: 'fail', detail };
}

export function skipped(id: string, detail: string): ProbeResult {
  return { id, status: 'skip', detail };
}

export function checked(id: string, ok: boolean, detail: string): ProbeResult {
  return ok ? passed(id, detail) : failed(id, detail);
}

export function exitCodeOf(results: readonly ProbeResult[]): 0 | 1 {
  return results.some((result) => result.status === 'fail') ? 1 : 0;
}

export function reportLines(results: readonly ProbeResult[]): string[] {
  const lines = results.map(
    (result) => `${result.status.toUpperCase().padEnd(6)} ${result.id.padEnd(5)} ${result.detail}`,
  );
  const count = (status: ProbeResult['status']) =>
    results.filter((result) => result.status === status).length;
  const total = `${String(count('pass'))} pass, ${String(count('fail'))} fail, ${String(count('skip'))} skip, ${String(count('manual'))} manual`;
  return [...lines, total];
}
