import type { BuildStep, Requirement } from './prd.ts';

type Unproven = { readonly id: string; readonly step: number | null; readonly due: boolean };
export type TraceReport = {
  readonly must: number;
  readonly proven: number;
  readonly unproven: readonly Unproven[];
};
type TraceInput = {
  readonly requirements: readonly Requirement[];
  readonly steps: readonly BuildStep[];
  readonly completed: ReadonlySet<number>;
  readonly proven: ReadonlySet<string>;
};

export function trace(input: TraceInput): TraceReport {
  const stepOf = new Map(
    input.steps.flatMap((step) => step.ids.map((id) => [id, step.step] as const)),
  );
  const must = input.requirements.filter((requirement) => requirement.priority === 'Must');
  const unproven = must
    .filter((requirement) => !input.proven.has(requirement.id))
    .map((requirement) => {
      const step = stepOf.get(requirement.id) ?? null;
      return { id: requirement.id, step, due: step === null || input.completed.has(step) };
    });
  return { must: must.length, proven: must.length - unproven.length, unproven };
}

function line(entry: Unproven): string {
  return `  ${entry.id}  (${entry.step === null ? 'in no build-order step' : `step ${entry.step}`})`;
}

export function formatTrace(report: TraceReport): string {
  const due = report.unproven.filter((entry) => entry.due);
  const later = report.unproven.filter((entry) => !entry.due);
  const head = `trace: ${report.must} Must requirements; ${report.proven} proven, ${report.unproven.length} unproven (${due.length} due, ${later.length} in steps not yet built)`;
  return [
    head,
    ...(due.length > 0 ? ['unproven and due:', ...due.map(line)] : []),
    ...(later.length > 0 ? ['unproven, step not yet built:', ...later.map(line)] : []),
  ].join('\n');
}

export function traceExitCode(report: TraceReport, mode: 'all' | 'built'): 0 | 1 {
  const failing = mode === 'all' ? report.unproven : report.unproven.filter((entry) => entry.due);
  return failing.length === 0 ? 0 : 1;
}
