import { describe, expect, it } from 'vitest';
import type { AgentSummary, AgentsView } from '@uw/harness';
import { grantPairs } from './standing-permissions.tsx';

function agent(title: string, capability: AgentSummary['capability'], live = true) {
  return {
    title,
    capability,
    identity: `agent:${title.toLowerCase()}`,
    status: live ? 'active' : 'suggested',
  } as AgentSummary;
}

function viewWith(...agents: readonly AgentSummary[]): AgentsView {
  return { agents } as unknown as AgentsView;
}

describe('#110 the grant form pairs each live agent with the work it can use', () => {
  it('offers a merge tier only with merge, and none with any other work', () => {
    const view = viewWith(
      agent('Merger', 'merge'),
      agent('Builder', 'build'),
      agent('Reviewer', 'review'),
      agent('Idle', 'build', false),
    );
    expect(grantPairs(view).map((pair) => pair.value)).toEqual([
      'agent:merger|merge|low',
      'agent:merger|merge|standard',
      'agent:builder|build',
      'agent:builder|fix',
      'agent:reviewer|review',
    ]);
  });
});
