import { connectorSchema } from '@uw/contracts';
import { describe, expect, it } from 'vitest';
import type { ConnectorRequest, Connectors, EffectConnector } from '../ports.ts';
import { describeNotWired } from './not-wired-cases.ts';

export type ConnectorsSubject = {
  readonly connectors: Connectors;
  refuseNext(connector: EffectConnector, reason: string): Promise<void>;
};

const effectConnectors = connectorSchema.options.filter(
  (connector): connector is EffectConnector => connector !== 'none',
);

function request(connector: EffectConnector): ConnectorRequest {
  return {
    connector,
    harnessId: 'b1000000-0000-4000-8000-000000000001',
    itemId: 'b1000000-0000-4000-8000-000000000002',
    traceId: 'b1000000-0000-4000-8000-000000000003',
    pullRequest: { repo: 'unfoldingWord/uw-platform', number: 7 },
    expectedHead: 'f'.repeat(40),
    message: 'connector contract fixture',
  };
}

export function describeConnectorsContract(
  adapter: string,
  open: () => Promise<ConnectorsSubject>,
): void {
  describe(`DX-3 connectors port contract on ${adapter}`, () => {
    it.each(effectConnectors)('%s resolves to an outcome and never rejects', async (connector) => {
      const subject = await open();
      expect(await subject.connectors.run(request(connector))).toMatchObject({
        outcome: 'succeeded',
      });
    });

    it('returns a refusal as an outcome carrying its reason, not as an exception', async () => {
      const subject = await open();
      await subject.refuseNext('merge', 'head_mismatch');
      expect(await subject.connectors.run(request('merge'))).toEqual({
        outcome: 'refused',
        reason: 'head_mismatch',
      });
    });

    it('leaves another connector succeeding after a refusal on one', async () => {
      const subject = await open();
      await subject.refuseNext('merge', 'head_mismatch');
      expect(await subject.connectors.run(request('deploy'))).toMatchObject({
        outcome: 'succeeded',
      });
    });
  });
}

export function describeConnectorsNotWired(adapter: string, connectors: Connectors): void {
  describeNotWired('connectors', adapter, connectors, { run: true } satisfies Record<
    keyof Connectors,
    true
  >);
}
