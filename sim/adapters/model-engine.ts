import { ToolOutsideToolsetError, type ModelEngine, type TurnResult } from '@uw/harness';

export type SimModelEngine = ModelEngine & {
  respondNextWith(result: TurnResult): void;
  pending(): number;
};

function idle(model: string): TurnResult {
  return {
    toolCalls: [],
    text: null,
    stopReason: 'end_turn',
    usage: { inputTokens: 0, outputTokens: 0, costMinor: 0, costBasis: 'metered' },
    resolvedProvider: null,
    resolvedModel: model,
  };
}

export function createSimModelEngine(): SimModelEngine {
  const script: TurnResult[] = [];
  return {
    turn: async (request) => {
      const result = script.shift() ?? idle(request.model);
      const outside = result.toolCalls.find((call) => !request.tools.includes(call.verb));
      if (outside) throw new ToolOutsideToolsetError(outside.verb);
      return structuredClone(result);
    },
    respondNextWith: (result) => {
      script.push(structuredClone(result));
    },
    pending: () => script.length,
  };
}
