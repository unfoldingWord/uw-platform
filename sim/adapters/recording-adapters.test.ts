import type { ConnectorRequest, PullRequestFacts, TurnRequest } from '@uw/harness';
import { describe, expect, it } from 'vitest';
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
  expectedHead: null,
  message,
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

const pullRequestFacts: PullRequestFacts = {
  ref: { repo: 'unfoldingWord/uw-platform', number: 3 },
  state: 'open',
  draft: false,
  head: 'a'.repeat(40),
  checks: [],
  reviews: [],
  freshAt: new Date('2026-10-01T09:00:00.000Z'),
};

describe('DX-4 the recording sim adapters', () => {
  it('lists every connector request in order, out of reach of the caller', async () => {
    const connectors = createSimConnectors();
    await connectors.run(connectorRequest('merge', 'first'));
    await connectors.run(connectorRequest('deploy', 'second'));
    const listed = connectors.calls() as ConnectorRequest[];
    expect(listed.map((call) => call.message)).toEqual(['first', 'second']);
    listed.pop();
    const [head] = listed;
    if (head) Object.assign(head, { message: 'changed' });
    expect(connectors.calls().map((call) => call.message)).toEqual(['first', 'second']);
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
    const facts = createSimGitHubFacts();
    facts.given(pullRequestFacts);
    const first = await facts.pullRequest(pullRequestFacts.ref);
    if (first) Object.assign(first, { head: 'z'.repeat(40) });
    expect((await facts.pullRequest(pullRequestFacts.ref))?.head).toBe('a'.repeat(40));
  });

  it('idles when nothing is scripted and counts the scripted turns', async () => {
    const engine = createSimModelEngine();
    expect(await engine.turn(engineRequest)).toEqual({
      toolCalls: [],
      text: null,
      stopReason: 'end_turn',
      usage: { inputTokens: 0, outputTokens: 0, costMinor: 0, costBasis: 'metered' },
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
