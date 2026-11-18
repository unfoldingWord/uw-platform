import {
  personaFrontmatterSchema,
  type CostBasis,
  type Harness,
  type HarnessEvent,
  type Identity,
  type ItemState,
  type RunFailure,
  type RunHibernation,
  type RunOutcome,
  type RunStepRecord,
} from '@uw/contracts';
import { allowed, isAgent } from '../access.ts';
import type { Caller } from '../caller.ts';
import { readAllEvents } from '../items/record.ts';
import { accepted, refused, type KernelOutcome } from '../outcome.ts';
import type { RunRow, StoreTransaction } from '../ports.ts';
import { harnessScene, type ScenePorts } from '../reads/scene.ts';
import { ownerOf } from '../runs/control.ts';
import { playByPlay } from './play.ts';
import type { PlayByPlay } from './types.ts';

const RECENT_RUNS = 50;

export type RunSpend =
  | { readonly basis: 'metered'; readonly amountMinor: number; readonly currency: 'USD' }
  | { readonly basis: 'subscription'; readonly tokens: number };

export type RunSummary = {
  readonly runId: string;
  readonly itemId: string;
  readonly itemTitle: string | null;
  readonly persona: Identity;
  readonly agentTitle: string | null;
  readonly outcome: RunOutcome;
  readonly hibernatedFor: RunHibernation | null;
  readonly failure: RunFailure | null;
  readonly spend: RunSpend;
  readonly startedAt: Date;
  readonly endedAt: Date | null;
  readonly canStop: boolean;
  readonly canTakeOver: boolean;
};

export type RunsView = { readonly harness: Harness; readonly runs: readonly RunSummary[] };

export type RunMark = {
  readonly name: 'run_resumed' | 'run_failed' | 'run_hibernated' | 'run_stopped';
  readonly why: string | null;
  readonly at: string;
};

export type RunView = {
  readonly harness: Harness;
  readonly run: RunSummary;
  readonly steps: readonly RunStepRecord[];
  readonly marks: readonly RunMark[];
  readonly play: PlayByPlay;
};

export type RunInput = {
  readonly harnessId: string;
  readonly runId: string;
  readonly after: number;
};

const markNames: ReadonlySet<string> = new Set([
  'run_resumed',
  'run_failed',
  'run_hibernated',
  'run_stopped',
]);

function tokensOf(steps: readonly RunStepRecord[]): number {
  return steps.reduce((sum, step) => sum + step.tokensIn + step.tokensOut, 0);
}

function spendOf(
  run: Pick<RunRow, 'costBasis' | 'costMinor' | 'computeMinor' | 'steps'>,
): RunSpend {
  if (run.costBasis === ('subscription' satisfies CostBasis)) {
    return { basis: 'subscription', tokens: tokensOf(run.steps) };
  }
  const amountMinor = (run.costMinor ?? 0) + (run.computeMinor ?? 0);
  return { basis: 'metered', amountMinor, currency: 'USD' };
}

function live(run: RunRow): boolean {
  return run.outcome === 'running' || run.outcome === 'hibernated';
}

type Viewer = { readonly caller: Caller; readonly harness: Harness; readonly at: Date };

async function mayStop(tx: StoreTransaction, viewer: Viewer, run: RunRow): Promise<boolean> {
  const { caller, harness, at } = viewer;
  if (!live(run) || isAgent(caller.actor) || !allowed(caller.actor, 'write', harness, at)) {
    return false;
  }
  if (allowed(caller.actor, 'admin', harness, at)) return true;
  const personId = caller.actor.personId;
  return personId !== null && (await ownerOf(tx, run)) === personId;
}

function mayTakeOver(viewer: Viewer, run: RunRow): boolean {
  const { caller, harness, at } = viewer;
  return live(run) && !isAgent(caller.actor) && allowed(caller.actor, 'admin', harness, at);
}

async function agentTitles(tx: StoreTransaction, harnessId: string) {
  const titles = new Map<string, string>();
  for (const page of await tx.pages.read.personasOf(harnessId)) {
    const front = personaFrontmatterSchema.safeParse(page.frontmatter);
    if (front.success && !titles.has(front.data.identity))
      titles.set(front.data.identity, page.title);
  }
  return titles;
}

type Names = {
  readonly items: ReadonlyMap<string, ItemState>;
  readonly agents: ReadonlyMap<string, string>;
};

async function summaryOf(
  tx: StoreTransaction,
  viewer: Viewer,
  names: Names,
  run: RunRow,
): Promise<RunSummary> {
  return {
    runId: run.id,
    itemId: run.itemId,
    itemTitle: names.items.get(run.itemId)?.title ?? null,
    persona: run.persona,
    agentTitle: names.agents.get(run.persona) ?? null,
    outcome: run.outcome,
    hibernatedFor: run.hibernatedFor,
    failure: run.failure,
    spend: spendOf(run),
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    canStop: await mayStop(tx, viewer, run),
    canTakeOver: mayTakeOver(viewer, run),
  };
}

async function summaries(
  tx: StoreTransaction,
  viewer: Viewer,
  runs: readonly RunRow[],
): Promise<readonly RunSummary[]> {
  const items = await tx.harnessItems.read.byIds([...new Set(runs.map((run) => run.itemId))]);
  const names = {
    items: new Map(items.map((item) => [item.itemId, item])),
    agents: await agentTitles(tx, viewer.harness.id),
  };
  const shown: RunSummary[] = [];
  for (const run of runs) shown.push(await summaryOf(tx, viewer, names, run));
  return shown;
}

export async function runsView(
  ports: ScenePorts,
  tx: StoreTransaction,
  caller: Caller,
  harnessId: string,
  at: Date,
): Promise<KernelOutcome<RunsView>> {
  const scene = await harnessScene(ports, tx, caller, harnessId, at);
  if (scene.status !== 'accepted') return scene;
  const { harness } = scene.value;
  const runs = await tx.harnessRuns.read.recent(harness.id, RECENT_RUNS);
  return accepted({ harness, runs: await summaries(tx, { caller, harness, at }, runs) });
}

function marksOf(events: readonly HarnessEvent[], runId: string): readonly RunMark[] {
  return events.flatMap((event) => {
    if (!markNames.has(event.name) || event.evidence['runId'] !== runId) return [];
    const why = event.evidence['why'];
    const name = event.name as RunMark['name'];
    return [{ name, why: typeof why === 'string' ? why : null, at: event.at }];
  });
}

export async function runView(
  ports: ScenePorts,
  tx: StoreTransaction,
  caller: Caller,
  input: RunInput,
  at: Date,
): Promise<KernelOutcome<RunView>> {
  const scene = await harnessScene(ports, tx, caller, input.harnessId, at);
  if (scene.status !== 'accepted') return scene;
  const { harness } = scene.value;
  const run = await tx.harnessRuns.read.byId(input.runId);
  if (run === null || run.harnessId !== harness.id) {
    return refused('run_not_found', { runId: input.runId });
  }
  const play = await playByPlay(ports, tx, caller, { itemId: run.itemId, after: input.after }, at);
  if (play.status !== 'accepted') return play;
  const [summary] = await summaries(tx, { caller, harness, at }, [run]);
  if (summary === undefined) return refused('run_not_found', { runId: input.runId });
  const events = await readAllEvents(tx, harness.id, run.itemId);
  return accepted({
    harness,
    run: summary,
    steps: run.steps,
    marks: marksOf(events, run.id),
    play: play.value,
  });
}
