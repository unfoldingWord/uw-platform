import type { Connectors, EffectConnector, EffectHandler } from '@uw/harness';
import { mergeHandler, type MergeGitHub } from '../github/merge.ts';

export type ShipGitHub = MergeGitHub;

const notWiredConnector: EffectHandler = {
  run: async () => ({ outcome: 'refused', reason: 'not_wired' }),
  outcomeOf: async () => ({ outcome: 'refused', reason: 'not_wired' }),
};

function handlersFor(github: ShipGitHub | null): ReadonlyMap<EffectConnector, EffectHandler> {
  return new Map<EffectConnector, EffectHandler>([
    ['merge', github === null ? notWiredConnector : mergeHandler(github)],
    ['deploy', notWiredConnector],
    ['publish', notWiredConnector],
    ['send', notWiredConnector],
    ['post', notWiredConnector],
  ]);
}

export function platformConnectors(github: ShipGitHub | null): Connectors {
  const handlers = handlersFor(github);
  const handlerOf = (connector: EffectConnector) => handlers.get(connector) ?? notWiredConnector;
  return {
    run: (request) => handlerOf(request.connector).run(request),
    outcomeOf: (request) => handlerOf(request.connector).outcomeOf(request),
    review: async () => ({ outcome: 'refused', reason: 'not_wired' }),
  };
}
