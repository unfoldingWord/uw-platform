import {
  ProviderMismatchError,
  ToolOutsideToolsetError,
  type ModelEngine,
  type TurnRequest,
  type TurnResult,
} from '@uw/harness';

export type SimModelEngine = ModelEngine & {
  respondNextWith(result: TurnResult): void;
  pending(): number;
};

function idle(request: TurnRequest): TurnResult {
  return {
    toolCalls: [],
    text: null,
    stopReason: 'end_turn',
    usage: { inputTokens: 0, outputTokens: 0, costMinor: 0, costBasis: 'metered' },
    resolvedProvider: request.pinnedProvider,
    resolvedModel: request.model,
  };
}

function assertToolResultsAnswerCalls(request: TurnRequest): void {
  const called = new Set<string>();
  for (const message of request.messages) {
    if (message.role === 'assistant') message.toolCalls.forEach((call) => called.add(call.callId));
    if (message.role === 'tool' && !called.has(message.callId)) {
      throw new Error(`tool result ${message.callId} answers no earlier tool call`);
    }
  }
}

export function createSimModelEngine(): SimModelEngine {
  const script: TurnResult[] = [];
  return {
    turn: async (request) => {
      assertToolResultsAnswerCalls(request);
      const result = script.shift() ?? idle(request);
      const pinned = request.pinnedProvider;
      if (pinned !== null && result.resolvedProvider !== pinned) {
        throw new ProviderMismatchError(pinned, result.resolvedProvider);
      }
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
