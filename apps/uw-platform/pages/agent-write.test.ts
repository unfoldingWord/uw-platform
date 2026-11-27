import { describe, expect, it } from 'vitest';
import { pageTypes } from '@uw/contracts';
import { agentEditOfActive } from './agent-write.ts';
import { isGatedType } from './gating.ts';

describe('#197 an agent edit to an active gated page takes the path its type names', () => {
  it('holds decisions, policies, charters and impact stories as review sets; the rest keep their own confirm or activation path', () => {
    const paths = pageTypes.filter(isGatedType).map((type) => [type, agentEditOfActive(type)]);
    expect(paths).toEqual([
      ['skill', 'refused'],
      ['learning', 'refused'],
      ['persona', 'refused'],
      ['platform', 'refused'],
      ['decision', 'review_set'],
      ['policy', 'review_set'],
      ['charter', 'review_set'],
      ['measure', 'refused'],
      ['dashboard', 'refused'],
      ['impact_story', 'review_set'],
    ]);
  });
});
