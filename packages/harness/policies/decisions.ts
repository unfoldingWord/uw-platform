export type DecisionFacts = {
  readonly id: string;
  readonly decidedOn: string;
  readonly supersedes: readonly string[];
};

function mayReplace(later: DecisionFacts, earlier: DecisionFacts): boolean {
  if (later.decidedOn !== earlier.decidedOn) return later.decidedOn > earlier.decidedOn;
  return !earlier.supersedes.includes(later.id);
}

export function supersededDecisions(decisions: readonly DecisionFacts[]): ReadonlySet<string> {
  const byId = new Map(decisions.map((decision) => [decision.id, decision]));
  const replaced = new Set<string>();
  for (const later of decisions) {
    for (const id of later.supersedes) {
      const earlier = byId.get(id);
      if (earlier !== undefined && mayReplace(later, earlier)) replaced.add(id);
    }
  }
  return replaced;
}
