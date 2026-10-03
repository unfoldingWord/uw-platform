import type { ConnectorOutcome, ConnectorRequest, Connectors, EffectConnector } from '@uw/harness';

export type SimConnectors = Connectors & {
  calls(): readonly ConnectorRequest[];
  refuseNext(connector: EffectConnector, reason: string): void;
  succeedNext(connector: EffectConnector): void;
};

type Programmed =
  { readonly outcome: 'succeeded' } | { readonly outcome: 'refused'; readonly reason: string };

const wired: ReadonlySet<EffectConnector> = new Set<EffectConnector>(['merge']);

function effectKey(request: ConnectorRequest): string {
  return JSON.stringify([request.connector, request.itemId, request.expectedHead]);
}

function defaultFor(connector: EffectConnector): Programmed {
  return wired.has(connector)
    ? { outcome: 'succeeded' }
    : { outcome: 'refused', reason: 'not_wired' };
}

export function createSimConnectors(): SimConnectors {
  const calls: ConnectorRequest[] = [];
  const programmed = new Map<EffectConnector, Programmed>();
  const effects = new Map<string, ConnectorOutcome>();
  return {
    run: async (request) => {
      calls.push(structuredClone(request));
      const next = programmed.get(request.connector) ?? defaultFor(request.connector);
      programmed.delete(request.connector);
      if (next.outcome === 'refused') return { outcome: 'refused', reason: next.reason };
      const outcome: ConnectorOutcome = { outcome: 'succeeded', detail: {} };
      effects.set(effectKey(request), outcome);
      return structuredClone(outcome);
    },
    outcomeOf: async (request) => {
      const outcome = effects.get(effectKey(request));
      return outcome === undefined ? null : structuredClone(outcome);
    },
    calls: () => calls.map((call) => structuredClone(call)),
    refuseNext: (connector, reason) => {
      programmed.set(connector, { outcome: 'refused', reason });
    },
    succeedNext: (connector) => {
      programmed.set(connector, { outcome: 'succeeded' });
    },
  };
}
