import { randomUUID } from 'node:crypto';
import { assistantTurnDepsOf } from '../assistants/turn/deps.ts';
import { runAssistantTurn } from '../assistants/turn/run.ts';
import type { AssistantSteps, Json, TurnStepConfig } from '../assistants/turn/steps.ts';
import type { TurnRig } from './turn-rig.ts';

export class Crash extends Error {}

export type Memory = Map<string, string>;

export function memorySteps(
  memory: Memory = new Map(),
  crashAt: string | null = null,
): AssistantSteps {
  return {
    do: async <T extends Json>(name: string, config: TurnStepConfig, body: () => Promise<T>) => {
      const kept = memory.get(name);
      if (kept !== undefined) return JSON.parse(kept) as T;
      if (name === crashAt) throw new Crash(`the host died before ${name}`);
      for (let attempt = 0; ; attempt += 1) {
        try {
          const text = JSON.stringify(await body());
          memory.set(name, text);
          return JSON.parse(text) as T;
        } catch (error) {
          if (attempt >= config.retries) throw error;
        }
      }
    },
  };
}

type Call = { readonly id: string; readonly name: string; readonly args: unknown };

export function completion(content: string | null, calls: readonly Call[]) {
  return {
    id: `gen-${randomUUID()}`,
    provider: 'Z.AI',
    model: 'z-ai/glm-5.3-flash',
    object: 'chat.completion',
    created: 1_795_000_000,
    choices: [
      {
        index: 0,
        finish_reason: calls.length === 0 ? 'stop' : 'tool_calls',
        message: {
          role: 'assistant',
          content,
          ...(calls.length === 0
            ? {}
            : {
                tool_calls: calls.map((call) => ({
                  id: call.id,
                  type: 'function',
                  function: { name: call.name, arguments: JSON.stringify(call.args) },
                })),
              }),
        },
      },
    ],
    usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110, cost: 0.0001 },
  };
}

export function run(rig: TurnRig, index: number, steps: AssistantSteps = memorySteps()) {
  const start = rig.started.at(index);
  if (start === undefined) throw new Error(`no turn was started at ${String(index)}`);
  const opened = assistantTurnDepsOf(rig.env, start.traceId, rig.fetcher);
  if (opened === null) throw new Error('the turn host has no database');
  return runAssistantTurn(start, steps, opened.deps).finally(() => opened.release());
}
