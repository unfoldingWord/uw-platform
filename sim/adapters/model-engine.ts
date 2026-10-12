import {
  ProviderMismatchError,
  ToolOutsideToolsetError,
  type Clock,
  type ModelEngine,
  type Spend,
  type TurnRequest,
  type TurnResult,
} from '@uw/harness';

type SpendAmount = Pick<Spend, 'spentMinor' | 'currency'>;

export type SimModelEngine = ModelEngine & {
  respondNextWith(result: TurnResult): void;
  pending(): number;
  setSpend(amount: SpendAmount): void;
};

function idle(request: TurnRequest): TurnResult {
  return {
    toolCalls: [],
    text: null,
    stopReason: 'end_turn',
    usage: { inputTokens: 0, outputTokens: 0, costMicros: 0, costBasis: 'metered' },
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

export function createSimModelEngine(clock: Clock): SimModelEngine {
  const script: TurnResult[] = [];
  let spent: SpendAmount = { spentMinor: 0, currency: 'USD' };
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
    spend: async (since) => ({ ...spent, since: new Date(since), asOf: clock.now() }),
    setSpend: (amount) => {
      spent = { spentMinor: amount.spentMinor, currency: amount.currency };
    },
  };
}
