import { connectorSchema } from '@uw/contracts';
import { describe, expect, it } from 'vitest';
import type { ConnectorRequest, Connectors, EffectConnector, ReviewRequest } from '../ports.ts';

export type ConnectorsSubject = {
  readonly connectors: Connectors;
  refuseNext(connector: EffectConnector, reason: string): Promise<void>;
  refuseNextReview(reason: string): Promise<void>;
};

type ReviewWrites = 'scripted' | 'not_wired';

const effectConnectors = connectorSchema.options.filter(
  (connector): connector is EffectConnector => connector !== 'none',
);
const notWiredConnectors = effectConnectors.filter((connector) => connector !== 'merge');

export const contractRequest = {
  harnessId: 'b1000000-0000-4000-8000-000000000001',
  itemId: 'b1000000-0000-4000-8000-000000000002',
  traceId: 'b1000000-0000-4000-8000-000000000003',
  pullRequest: { repo: 'unfoldingWord/uw-platform', number: 7 },
  joined: false,
  expectedHead: 'f'.repeat(40),
  expectedBase: { sha: 'e'.repeat(40), ref: 'main' },
  repository: 'unfoldingWord/uw-platform',
  title: 'connector contract fixture',
  overrideReason: null,
} as const;

const contractReview: ReviewRequest = {
  reviewer: 'uw-reviewer',
  repository: 'unfoldingWord/uw-platform',
  pullRequest: { repo: 'unfoldingWord/uw-platform', number: 7 },
  head: 'f'.repeat(40),
  verdict: 'request_changes',
  body: ['```harness-review', 'provider: fixture-provider', 'model: fixture-model', '```'].join(
    '\n',
  ),
  traceId: 'b1000000-0000-4000-8000-000000000004',
};

function request(connector: EffectConnector): ConnectorRequest {
  return { ...contractRequest, connector };
}

const anOutcome = { outcome: expect.stringMatching(/^(?:succeeded|refused)$/) };

function describeRuns(open: () => Promise<ConnectorsSubject>): void {
  it.each(effectConnectors)('%s resolves to an outcome and never rejects', async (connector) => {
    const subject = await open();
    expect(await subject.connectors.run(request(connector))).toMatchObject(anOutcome);
  });

  it.each(notWiredConnectors)('%s answers refused not_wired', async (connector) => {
    const subject = await open();
    expect(await subject.connectors.run(request(connector))).toEqual({
      outcome: 'refused',
      reason: 'not_wired',
    });
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

  it.each(notWiredConnectors)(
    '%s answers its outcome read refused not_wired, never no outcome',
    async (connector) => {
      const subject = await open();
      await subject.connectors.run(request(connector));
      expect(await subject.connectors.outcomeOf(request(connector))).toEqual({
        outcome: 'refused',
        reason: 'not_wired',
      });
    },
  );

  it.each(effectConnectors)('%s answers its outcome and never rejects', async (connector) => {
    const subject = await open();
    const answer = await subject.connectors.outcomeOf(request(connector));
    expect(answer === null || ['succeeded', 'refused'].includes(answer.outcome)).toBe(true);
  });
}

function describeReviews(open: () => Promise<ConnectorsSubject>): void {
  it('posts a review and answers its whole-number id', async () => {
    const subject = await open();
    const answer = await subject.connectors.review(contractReview);
    expect(answer.outcome).toBe('posted');
    if (answer.outcome === 'posted') {
      expect(Number.isSafeInteger(answer.reviewId) && answer.reviewId > 0).toBe(true);
    }
  });

  it('returns a refused review as an outcome carrying its reason, not as an exception', async () => {
    const subject = await open();
    await subject.refuseNextReview('head_moved');
    expect(await subject.connectors.review(contractReview)).toEqual({
      outcome: 'refused',
      reason: 'head_moved',
    });
    expect(await subject.connectors.review(contractReview)).toMatchObject({ outcome: 'posted' });
  });

  it('refuses a review whose pull request is outside the repository it names', async () => {
    const subject = await open();
    const elsewhere = {
      ...contractReview,
      pullRequest: { repo: 'unfoldingWord/other', number: 7 },
    };
    expect(await subject.connectors.review(elsewhere)).toEqual({
      outcome: 'refused',
      reason: 'repository_mismatch',
    });
  });
}

function describeReviewsNotWired(open: () => Promise<ConnectorsSubject>): void {
  it('answers every review refused not_wired until the review write is wired', async () => {
    const subject = await open();
    expect(await subject.connectors.review(contractReview)).toEqual({
      outcome: 'refused',
      reason: 'not_wired',
    });
  });
}

export function describeConnectorsContract(
  adapter: string,
  open: () => Promise<ConnectorsSubject>,
  reviews: ReviewWrites,
): void {
  describe(`DX-3 connectors port contract on ${adapter}`, () => {
    describeRuns(open);
    describeOutcomes(open);
    if (reviews === 'scripted') describeReviews(open);
    else describeReviewsNotWired(open);
  });
}
