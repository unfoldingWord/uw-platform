import { connectorSchema } from '@uw/contracts';
import { describe, expect, it } from 'vitest';
import type { ConnectorRequest, Connectors, EffectConnector } from '../ports.ts';

export type ConnectorsSubject = {
  readonly connectors: Connectors;
  refuseNext(connector: EffectConnector, reason: string): Promise<void>;
};

const effectConnectors = connectorSchema.options.filter(
  (connector): connector is EffectConnector => connector !== 'none',
);

export const contractRequest = {
  harnessId: 'b1000000-0000-4000-8000-000000000001',
  itemId: 'b1000000-0000-4000-8000-000000000002',
  traceId: 'b1000000-0000-4000-8000-000000000003',
  pullRequest: { repo: 'unfoldingWord/uw-platform', number: 7 },
  expectedHead: 'f'.repeat(40),
  expectedBase: 'e'.repeat(40),
  repository: 'unfoldingWord/uw-platform',
  message: 'connector contract fixture',
} as const;

function request(connector: EffectConnector): ConnectorRequest {
  return { ...contractRequest, connector };
}

const anOutcome = { outcome: expect.stringMatching(/^(?:succeeded|refused)$/) };

function describeRuns(open: () => Promise<ConnectorsSubject>): void {
  it.each(effectConnectors)('%s resolves to an outcome and never rejects', async (connector) => {
    const subject = await open();
    expect(await subject.connectors.run(request(connector))).toMatchObject(anOutcome);
  });

  it('runs the merge connector to success', async () => {
    const subject = await open();
    expect(await subject.connectors.run(request('merge'))).toMatchObject({
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

  it('runs the merge connector to success again after a refusal', async () => {
    const subject = await open();
    await subject.refuseNext('merge', 'head_mismatch');
    await subject.connectors.run(request('merge'));
    expect(await subject.connectors.run(request('merge'))).toMatchObject({
      outcome: 'succeeded',
    });
  });
}

function describeOutcomes(open: () => Promise<ConnectorsSubject>): void {
  it('answers no outcome for a merge that has not run', async () => {
    const subject = await open();
    expect(await subject.connectors.outcomeOf(request('merge'))).toBeNull();
  });

  it('answers the succeeded outcome of a merge that ran', async () => {
    const subject = await open();
    await subject.connectors.run(request('merge'));
    expect(await subject.connectors.outcomeOf(request('merge'))).toMatchObject({
      outcome: 'succeeded',
    });
  });

  it.each(effectConnectors)('%s answers its outcome and never rejects', async (connector) => {
    const subject = await open();
    const answer = await subject.connectors.outcomeOf(request(connector));
    expect(answer === null || ['succeeded', 'refused'].includes(answer.outcome)).toBe(true);
  });
}

export function describeConnectorsContract(
  adapter: string,
  open: () => Promise<ConnectorsSubject>,
): void {
  describe(`DX-3 connectors port contract on ${adapter}`, () => {
    describeRuns(open);
    describeOutcomes(open);
  });
}
