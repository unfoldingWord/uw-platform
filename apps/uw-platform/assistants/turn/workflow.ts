import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import { z } from 'zod';
import type { AssistantTurnStart, Bindings } from '../../env.ts';
import { withSecrets } from '../../secrets.ts';
import { assistantTurnDepsOf } from './deps.ts';
import { runAssistantTurn } from './run.ts';
import type { AssistantSteps, Json, TurnStepConfig } from './steps.ts';

const startSchema = z.strictObject({ requestId: z.uuid(), traceId: z.uuid() });
const RETRY_DELAY = '10 seconds' as const;

function fromJson<T extends Json>(text: string): T {
  const value: unknown = JSON.parse(text);
  return value as T;
}

function workflowSteps(step: WorkflowStep): AssistantSteps {
  return {
    do: async <T extends Json>(name: string, config: TurnStepConfig, body: () => Promise<T>) => {
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
  };
}

export class AssistantTurn extends WorkflowEntrypoint<Bindings, AssistantTurnStart> {
  override async run(
    event: Readonly<WorkflowEvent<AssistantTurnStart>>,
    step: WorkflowStep,
  ): Promise<string> {
    const start = startSchema.parse(event.payload);
    const opened = assistantTurnDepsOf(await withSecrets(this.env), start.traceId);
    if (opened === null) return 'database_not_configured';
    try {
      return await runAssistantTurn(start, workflowSteps(step), opened.deps);
    } finally {
      await opened.release();
    }
  }
}
