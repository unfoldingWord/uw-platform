import type { ConnectorOutcome, ConnectorRequest, Connectors, EffectConnector } from '@uw/harness';

export type SimConnectors = Connectors & {
  calls(): readonly ConnectorRequest[];
  refuseNext(connector: EffectConnector, reason: string): void;
};

function effectKey(request: ConnectorRequest): string {
  return JSON.stringify([request.connector, request.itemId, request.expectedHead]);
}

export function createSimConnectors(): SimConnectors {
  const calls: ConnectorRequest[] = [];
  const refusals = new Map<EffectConnector, string>();
  const effects = new Map<string, ConnectorOutcome>();
  return {
    run: async (request) => {
      calls.push(structuredClone(request));
      const reason = refusals.get(request.connector);
      if (reason === undefined) {
        const outcome: ConnectorOutcome = { outcome: 'succeeded', detail: {} };
        effects.set(effectKey(request), outcome);
        return structuredClone(outcome);
      }
      refusals.delete(request.connector);
      return { outcome: 'refused', reason };
    },
    outcomeOf: async (request) => {
      const outcome = effects.get(effectKey(request));
      return outcome === undefined ? null : structuredClone(outcome);
    },
    calls: () => calls.map((call) => structuredClone(call)),
    refuseNext: (connector, reason) => {
      refusals.set(connector, reason);
    },
  };
}
