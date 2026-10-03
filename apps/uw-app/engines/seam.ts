import type { Engine, VerbName } from '@uw/contracts';
import { runToolLoop, type ModelEngine, type ToolCaller } from '@uw/harness';

type EngineEgress = {
  readonly mcp: (request: Request) => Promise<Response>;
  refused(host: string): void;
};

export type EngineWork = {
  readonly runId: string;
  readonly itemId: string;
  readonly traceId: string;
  readonly persona: string;
  readonly model: string;
  readonly pinnedProvider: string;
  readonly instructions: string;
  readonly prompt: string;
  readonly toolset: readonly VerbName[];
  readonly tools: ToolCaller;
  readonly onTurn: () => Promise<void>;
  readonly egress: EngineEgress;
};

export type EngineWorkResult = {
  readonly outcome: 'ended' | 'turn_limit';
  readonly text: string | null;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costMicros: number | null;
  readonly computeMinor: number | null;
  readonly resolvedProvider: string | null;
  readonly resolvedModel: string;
  readonly toolsCalled: readonly VerbName[];
};

export type EngineAdapter = {
  readonly key: Engine;
  readonly turn: ModelEngine['turn'] | null;
  work(input: EngineWork): Promise<EngineWorkResult>;
};

export function messageWork(
  engine: Engine,
  turn: ModelEngine['turn'],
): (input: EngineWork) => Promise<EngineWorkResult> {
  return async (input) => {
    const { model, pinnedProvider, persona, instructions, traceId, prompt } = input;
    const request = { engine, model, pinnedProvider, persona, instructions, traceId, prompt };
    const loop = await runToolLoop(
      turn,
      input.tools,
      { ...request, tools: input.toolset },
      input.onTurn,
    );
    return {
      outcome: loop.outcome,
      text: loop.text,
      inputTokens: loop.usage.inputTokens,
      outputTokens: loop.usage.outputTokens,
      costMicros: loop.usage.costMicros,
      computeMinor: null,
      resolvedProvider: loop.resolvedProvider,
      resolvedModel: loop.resolvedModel,
      toolsCalled: loop.toolsCalled,
    };
  };
}
