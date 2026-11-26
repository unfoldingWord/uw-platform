import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import { z } from 'zod';
import type { Bindings } from '../env.ts';
import { hyperdriveDatabase } from '../database.ts';
import { bucketFiles } from '../pages/file-store.ts';
import { systemClock } from '../ports/clock.ts';
import { withSecrets } from '../secrets.ts';
import { runMeasure, type MeasureStep } from './run-measure.ts';
import { unwiredRun, type RunDeps } from './run-steps.ts';
import { measureSandboxFrom, type MeasureRunStart } from './sandbox.ts';
import { STEP_BUDGETS, type StepKind } from './step-budgets.ts';

const startSchema = z.object({ runId: z.uuid(), traceId: z.uuid() });

function measureStep(step: WorkflowStep): MeasureStep {
  return async <T>(name: string, work: () => Promise<T>, kind: StepKind): Promise<T> => {
    const budget = kind === 'sandbox' ? STEP_BUDGETS.sandbox : STEP_BUDGETS.record;
    const text = await step.do<string>(name, budget, async () => JSON.stringify(await work()));
    const value: unknown = JSON.parse(text);
    return value as T;
  };
}

export class MeasureRun extends WorkflowEntrypoint<Bindings, MeasureRunStart> {
  override async run(
    event: Readonly<WorkflowEvent<MeasureRunStart>>,
    step: WorkflowStep,
  ): Promise<string> {
    const start = startSchema.parse(event.payload);
    const env = await withSecrets(this.env);
    const database = hyperdriveDatabase(env);
    if (database === null) return 'database_not_configured';
    const now = () => systemClock.now();
    try {
      const sandbox = measureSandboxFrom(env);
      if (env.FILES === undefined || sandbox === null) {
        const unwired = () => unwiredRun(database.db, start.runId, now());
        return await step.do('unwired', STEP_BUDGETS.record, unwired);
      }
      const deps: RunDeps = { db: database.db, files: bucketFiles(env.FILES), sandbox, now };
      return await runMeasure(deps, start.runId, measureStep(step));
    } finally {
      await database.release();
    }
  }
}
