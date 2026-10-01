import type { ConnectorRequest, Connectors, EffectConnector } from '@uw/harness';

export type SimConnectors = Connectors & {
  calls(): readonly ConnectorRequest[];
  refuseNext(connector: EffectConnector, reason: string): void;
};

export function createSimConnectors(): SimConnectors {
  const calls: ConnectorRequest[] = [];
  const refusals = new Map<EffectConnector, string>();
  return {
    run: async (request) => {
      calls.push(structuredClone(request));
      const reason = refusals.get(request.connector);
      if (reason === undefined) return { outcome: 'succeeded', detail: {} };
      refusals.delete(request.connector);
      return { outcome: 'refused', reason };
    },
    calls: () => calls.map((call) => structuredClone(call)),
    refuseNext: (connector, reason) => {
      refusals.set(connector, reason);
    },
  };
}
