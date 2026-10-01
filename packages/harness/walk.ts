import type { Connector, ExitGate } from '@uw/contracts';

export type WalkStage = {
  readonly key: string;
  readonly position: number;
  readonly exitGate: ExitGate;
  readonly connector: Connector;
  readonly feeds: readonly string[];
};

export type WalkStep = {
  readonly key: string;
  readonly exitGate: ExitGate;
  readonly connector: Connector;
  readonly revisited: boolean;
};

export type WalkPath = readonly WalkStep[];

export type EffectPath = { readonly steps: readonly WalkStep[] };

export class WalkError extends Error {
  readonly stage: string;

  constructor(stage: string, message: string) {
    super(message);
    this.name = 'WalkError';
    this.stage = stage;
  }
}

function byPosition(a: WalkStage, b: WalkStage): number {
  if (a.position !== b.position) return a.position - b.position;
  return a.key < b.key ? -1 : 1;
}

function assertDistinctPositions(sequence: readonly WalkStage[]): void {
  sequence.forEach((stage, index) => {
    const previous = sequence[index - 1];
    if (previous && previous.position === stage.position) {
      throw new WalkError(
        previous.key,
        `stages ${previous.key} and ${stage.key} share position ${stage.position}`,
      );
    }
  });
}

function indexStages(sequence: readonly WalkStage[]): ReadonlyMap<string, WalkStage> {
  const byKey = new Map<string, WalkStage>();
  for (const stage of sequence) {
    if (byKey.has(stage.key)) throw new WalkError(stage.key, `stage ${stage.key} appears twice`);
    byKey.set(stage.key, stage);
  }
  for (const stage of sequence) {
    const dangling = stage.feeds.find((target) => !byKey.has(target));
    if (dangling !== undefined) {
      throw new WalkError(stage.key, `stage ${stage.key} feeds unknown stage ${dangling}`);
    }
  }
  return byKey;
}

function step(stage: WalkStage, revisited: boolean): WalkStep {
  return { key: stage.key, exitGate: stage.exitGate, connector: stage.connector, revisited };
}

type Graph = {
  readonly sequence: readonly WalkStage[];
  readonly byKey: ReadonlyMap<string, WalkStage>;
};

function successors(graph: Graph, stage: WalkStage): WalkStage[] {
  const next = graph.sequence[graph.sequence.indexOf(stage) + 1];
  const targets = new Set([...(next ? [next.key] : []), ...stage.feeds]);
  return [...targets].flatMap((key) => {
    const found = graph.byKey.get(key);
    return found ? [found] : [];
  });
}

function visit(graph: Graph, stage: WalkStage, trail: WalkPath, found: WalkPath[]): void {
  const here = [...trail, step(stage, false)];
  const next = successors(graph, stage);
  if (next.length === 0) {
    found.push(here);
    return;
  }
  for (const target of next) {
    if (here.some((visited) => visited.key === target.key))
      found.push([...here, step(target, true)]);
    else visit(graph, target, here, found);
  }
}

export function walk(stages: readonly WalkStage[]): WalkPath[] {
  const sequence = [...stages].sort(byPosition);
  assertDistinctPositions(sequence);
  const graph: Graph = { sequence, byKey: indexStages(sequence) };
  const first = sequence[0];
  if (!first) return [];
  const found: WalkPath[] = [];
  visit(graph, first, [], found);
  return found;
}

function signature(steps: readonly WalkStep[]): string {
  return steps.map((entry) => `${entry.key}${entry.revisited ? '*' : ''}`).join('>');
}

export function effectPaths(paths: readonly WalkPath[]): EffectPath[] {
  const seen = new Set<string>();
  const found: EffectPath[] = [];
  for (const path of paths) {
    path.forEach((entry, index) => {
      if (entry.connector === 'none') return;
      const steps = path.slice(0, index + 1);
      if (seen.has(signature(steps))) return;
      seen.add(signature(steps));
      found.push({ steps });
    });
  }
  return found;
}
