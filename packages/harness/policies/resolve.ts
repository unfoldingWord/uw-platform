import type { PolicyEnforcement, PolicyLevel } from '@uw/contracts';

export type PolicyChainLink = { readonly level: PolicyLevel; readonly pageId: string | null };

export type PolicyChain = readonly PolicyChainLink[];

export type PolicyCandidate = {
  readonly id: string;
  readonly enforcement: PolicyEnforcement;
  readonly appliesTo: string | null;
  readonly supersedes: readonly string[];
  readonly effectiveFrom: string;
  readonly effectiveUntil: string | null;
};

export type ResolvedPolicy = PolicyCandidate & { readonly level: PolicyLevel };

type PolicyConflictWhy = 'required_holds' | 'not_a_descendant';

export type PolicyConflict = {
  readonly id: string;
  readonly supersedes: string;
  readonly why: PolicyConflictWhy;
};

export type PolicyResolution = {
  readonly inForce: readonly ResolvedPolicy[];
  readonly yielded: readonly { readonly id: string; readonly supersededBy: string }[];
  readonly conflicts: readonly PolicyConflict[];
};

type Placed = ResolvedPolicy & { readonly depth: number };

const enforcementOrder: Readonly<Record<PolicyEnforcement, number>> = {
  required: 0,
  default: 1,
  template: 2,
};

function inEffect(candidate: PolicyCandidate, on: string): boolean {
  if (candidate.effectiveFrom > on) return false;
  return candidate.effectiveUntil === null || on < candidate.effectiveUntil;
}

function placedOn(
  chain: PolicyChain,
  candidates: readonly PolicyCandidate[],
  on: string,
): Placed[] {
  const seen = new Set<string>();
  return candidates.flatMap((candidate) => {
    const depth = chain.findIndex((link) => link.pageId === candidate.appliesTo);
    const link = depth === -1 ? undefined : chain.at(depth);
    if (link === undefined || seen.has(candidate.id) || !inEffect(candidate, on)) return [];
    seen.add(candidate.id);
    return [{ ...candidate, level: link.level, depth }];
  });
}

function byPrecedence(a: Placed, b: Placed): number {
  if (a.depth !== b.depth) return a.depth - b.depth;
  const enforced = enforcementOrder[a.enforcement] - enforcementOrder[b.enforcement];
  if (enforced !== 0) return enforced;
  if (a.effectiveFrom !== b.effectiveFrom) return a.effectiveFrom > b.effectiveFrom ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function why(replacing: Placed, replaced: Placed): PolicyConflictWhy | null {
  if (replacing.depth >= replaced.depth) return 'not_a_descendant';
  return replaced.enforcement === 'required' ? 'required_holds' : null;
}

function withoutDepth(placed: Placed): ResolvedPolicy {
  return {
    id: placed.id,
    enforcement: placed.enforcement,
    appliesTo: placed.appliesTo,
    supersedes: placed.supersedes,
    effectiveFrom: placed.effectiveFrom,
    effectiveUntil: placed.effectiveUntil,
    level: placed.level,
  };
}

export function resolvePolicies(
  chain: PolicyChain,
  candidates: readonly PolicyCandidate[],
  on: string,
): PolicyResolution {
  const placed = placedOn(chain, candidates, on).toSorted(byPrecedence);
  const byId = new Map(placed.map((policy) => [policy.id, policy]));
  const supersededBy = new Map<string, string>();
  const conflicts: PolicyConflict[] = [];
  for (const replacing of placed) {
    for (const id of replacing.supersedes) {
      const replaced = byId.get(id);
      if (replaced === undefined) continue;
      const refused = why(replacing, replaced);
      if (refused !== null) conflicts.push({ id: replacing.id, supersedes: id, why: refused });
      else if (!supersededBy.has(id)) supersededBy.set(id, replacing.id);
    }
  }
  return {
    inForce: placed.filter((policy) => !supersededBy.has(policy.id)).map(withoutDepth),
    yielded: [...supersededBy].map(([id, by]) => ({ id, supersededBy: by })),
    conflicts: conflicts.toSorted((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  };
}
