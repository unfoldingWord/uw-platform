import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import { z } from 'zod';
import { engineSchema, runShapeSchema } from '@uw/contracts';
import type { Bindings } from '../env.ts';
import { runDepsOf } from './deps.ts';
import { runWorkflow } from './run-core.ts';
import type { Json, StepConfig, StepRunner } from './step-runner.ts';

const runStartSchema = z.object({
  runId: z.uuid(),
  harnessId: z.uuid(),
  itemId: z.uuid(),
  persona: z.string().min(1).max(200),
  runShape: runShapeSchema,
  engine: engineSchema,
  traceId: z.uuid(),
});

const RETRY_DELAY = '10 seconds' as const;

function fromJson<T extends Json>(text: string): T {
  const value: unknown = JSON.parse(text);
  return value as T;
}

function workflowStepRunner(step: WorkflowStep): StepRunner {
  return {
    do: async <T extends Json>(name: string, config: StepConfig, body: () => Promise<T>) => {
      const retries = {
        limit: config.retries,
        delay: RETRY_DELAY,
        backoff: 'exponential' as const,
      };
      const text = await step.do<string>(name, { retries, timeout: config.timeout }, async () =>
        JSON.stringify(await body()),
      );
      return fromJson<T>(text);
    },
    waitForResume: async (name, timeout) => {
      try {
        await step.waitForEvent<string>(name, {
          type: 'run-resumed',
          timeout,
        });
        return 'resumed';
      } catch {
        return 'timed_out';
      }
    },
  };
}

export class HarnessRun extends WorkflowEntrypoint<Bindings, z.infer<typeof runStartSchema>> {
  override async run(
    event: Readonly<WorkflowEvent<z.infer<typeof runStartSchema>>>,
    step: WorkflowStep,
  ): Promise<string> {
    const start = runStartSchema.parse(event.payload);
    const opened = runDepsOf(this.env, start.traceId);
    try {
      return await runWorkflow(start, workflowStepRunner(step), opened.deps);
    } finally {
      await opened.release();
    }
  }
}
