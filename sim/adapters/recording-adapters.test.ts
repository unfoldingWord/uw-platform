import type { ConnectorRequest, PullRequestFacts, ReviewRequest, TurnRequest } from '@uw/harness';
import { describe, expect, it } from 'vitest';
import { createSimClock } from './clock.ts';
import { createSimConnectors } from './connectors.ts';
import { createSimGitHubFacts } from './github-facts.ts';
import { createSimModelEngine } from './model-engine.ts';

const connectorRequest = (
  connector: ConnectorRequest['connector'],
  message: string,
): ConnectorRequest => ({
  connector,
  harnessId: 'b1000000-0000-4000-8000-000000000001',
  itemId: 'b1000000-0000-4000-8000-000000000002',
  traceId: 'b1000000-0000-4000-8000-000000000003',
  pullRequest: null,
  joined: false,
  expectedHead: null,
  expectedBase: null,
  repository: null,
  title: message,
  overrideReason: null,
});

const engineRequest: TurnRequest = {
  engine: 'openrouter-messages',
  model: 'fixture-model',
  pinnedProvider: null,
  persona: 'builder',
  instructions: 'recording fixture',
  tools: ['read_page'],
  messages: [{ role: 'user', text: 'begin' }],
  traceId: 'b2000000-0000-4000-8000-000000000001',
};

const reviewRequest: ReviewRequest = {
  reviewer: 'uw-reviewer',
  repository: 'unfoldingWord/uw-platform',
  pullRequest: { repo: 'unfoldingWord/uw-platform', number: 3 },
  head: 'a'.repeat(40),
  verdict: 'approve',
  body: 'recording fixture',
  traceId: 'b2000000-0000-4000-8000-000000000002',
};

const pullRequestFacts: PullRequestFacts = {
  ref: { repo: 'unfoldingWord/uw-platform', number: 3 },
  state: 'open',
  draft: false,
  head: 'a'.repeat(40),
  headRef: 'harness/b1000000-0000-4000-8000-000000000003',
  headRepo: 'unfoldingWord/uw-platform',
  base: '0'.repeat(40),
  baseRef: 'main',
  defaultBranch: 'main',
  checks: [],
  reviews: [],
  files: null,
  declaration: null,
  closes: [],
  comparison: null,
  freshAt: new Date('2026-10-01T09:00:00.000Z'),
};

describe('DX-4 the recording sim adapters', () => {
  it('lists every connector request in order, out of reach of the caller', async () => {
    const connectors = createSimConnectors();
    await connectors.run(connectorRequest('merge', 'first'));
    await connectors.run(connectorRequest('deploy', 'second'));
    const listed = connectors.calls() as ConnectorRequest[];
    expect(listed.map((call) => call.title)).toEqual(['first', 'second']);
    listed.pop();
    const [head] = listed;
    if (head) Object.assign(head, { title: 'changed' });
    expect(connectors.calls().map((call) => call.title)).toEqual(['first', 'second']);
  });

  it('applies a refusal once, then the connector succeeds again', async () => {
    const connectors = createSimConnectors();
    connectors.refuseNext('merge', 'head_mismatch');
    expect(await connectors.run(connectorRequest('merge', 'a'))).toEqual({
      outcome: 'refused',
      reason: 'head_mismatch',
    });
    expect(await connectors.run(connectorRequest('merge', 'b'))).toMatchObject({
      outcome: 'succeeded',
    });
  });

  it('answers a copy of the facts it holds', async () => {
    const facts = createSimGitHubFacts(createSimClock(new Date('2026-10-01T09:00:00.000Z')));
    facts.given(pullRequestFacts);
    const first = await facts.pullRequest(pullRequestFacts.ref);
    if (first) Object.assign(first, { head: 'z'.repeat(40) });
    expect((await facts.pullRequest(pullRequestFacts.ref))?.head).toBe('a'.repeat(40));
  });

  it('idles when nothing is scripted and counts the scripted turns', async () => {
    const engine = createSimModelEngine(createSimClock(new Date('2026-10-01T09:30:00.000Z')));
    expect(await engine.turn(engineRequest)).toEqual({
      toolCalls: [],
      text: null,
      stopReason: 'end_turn',
      usage: { inputTokens: 0, outputTokens: 0, costMicros: 0, costBasis: 'metered' },
      resolvedProvider: null,
      resolvedModel: 'fixture-model',
    });
    expect(engine.pending()).toBe(0);
    const scripted = await engine.turn(engineRequest);
    engine.respondNextWith(scripted);
    engine.respondNextWith(scripted);
    expect(engine.pending()).toBe(2);
  });
});

describe('DX-4 the recording sim connectors answer not wired where the platform does', () => {
  it('answers not_wired for the four unwired connectors until a test programs a success', async () => {
    const connectors = createSimConnectors();
    for (const connector of ['deploy', 'publish', 'send', 'post'] as const) {
      expect(await connectors.run(connectorRequest(connector, 'a'))).toEqual({
        outcome: 'refused',
        reason: 'not_wired',
      });
    }
    connectors.succeedNext('send');
    expect(await connectors.run(connectorRequest('send', 'b'))).toMatchObject({
      outcome: 'succeeded',
    });
    expect(await connectors.run(connectorRequest('send', 'c'))).toMatchObject({
      outcome: 'refused',
    });
  });
});

describe('the review and spend sim adapters', () => {
  it('lists every posted review, never a refused one, out of reach of the caller', async () => {
    const connectors = createSimConnectors();
    connectors.refuseNextReview('head_moved');
    await connectors.review({ ...reviewRequest, body: 'refused' });
    await connectors.review({ ...reviewRequest, body: 'posted' });
    const listed = connectors.reviews() as ReviewRequest[];
    expect(listed.map((review) => review.body)).toEqual(['posted']);
    listed.pop();
    expect(connectors.reviews()).toHaveLength(1);
  });

  it('answers zero US cents of spend until a spend is set, read at the sim clock', async () => {
    const clock = createSimClock(new Date('2026-10-01T09:30:00.000Z'));
    const engine = createSimModelEngine(clock);
    const since = new Date('2026-10-01T00:00:00.000Z');
    expect(await engine.spend(since)).toEqual({
      spentMinor: 0,
      currency: 'USD',
      since,
      asOf: clock.now(),
    });
  });
});
