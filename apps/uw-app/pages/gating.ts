import type { PageType } from '@uw/contracts';

type Gating = 'gated' | 'open';

const gatingByType = {
  skill: 'gated',
  learning: 'gated',
  persona: 'gated',
  product: 'open',
  system_goal: 'open',
  product_strategy: 'open',
  data_sources: 'open',
} as const satisfies Record<PageType, Gating>;

const gating: ReadonlyMap<string, Gating> = new Map(Object.entries(gatingByType));

export function gatingOf(type: PageType): Gating {
  const found = gating.get(type);
  if (found === undefined) throw new Error(`page type ${type} is not classified`);
  return found;
}

export function isGatedType(type: string): boolean {
  return gating.get(type) === 'gated';
}
