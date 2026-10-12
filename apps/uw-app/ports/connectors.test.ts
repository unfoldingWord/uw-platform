import { beforeAll, describe, expect, it } from 'vitest';
import type { EffectConnector } from '@uw/harness';
import { contractRequest } from '@uw/harness/port-contracts/connectors';
import { fixtureApp, fixtureTransport } from '../github/testing/app-key.ts';
import { fixtureGitHub } from '../github/testing/fixture-github.ts';
import { platformConnectors, type ShipGitHub } from './connectors.ts';

const notWired = ['deploy', 'publish', 'send', 'post'] as const satisfies EffectConnector[];

let ship: ShipGitHub;

beforeAll(async () => {
  ship = { app: await fixtureApp(), transport: fixtureTransport(fixtureGitHub()) };
});

describe('GH-7 deploy, publish, send and post answer not wired on the platform adapter', () => {
  it.each(notWired)(
    '%s answers refused not_wired for the run and for the outcome read',
    async (connector) => {
      for (const connectors of [platformConnectors(null), platformConnectors(ship)]) {
        const request = { ...contractRequest, connector };
        expect(await connectors.run(request)).toEqual({ outcome: 'refused', reason: 'not_wired' });
        expect(await connectors.outcomeOf(request)).toEqual({
          outcome: 'refused',
          reason: 'not_wired',
        });
      }
    },
  );

  it('answers the merge and its outcome read not_wired when the adapter holds no ship GitHub', async () => {
    const connectors = platformConnectors(null);
    const request = { ...contractRequest, connector: 'merge' } as const;
    expect(await connectors.run(request)).toEqual({ outcome: 'refused', reason: 'not_wired' });
    expect(await connectors.outcomeOf(request)).toEqual({
      outcome: 'refused',
      reason: 'not_wired',
    });
  });
});
