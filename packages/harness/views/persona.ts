import {
  personaFrontmatterSchema,
  personaSlugOf,
  type ApproveAt,
  type CapabilityWord,
  type Engine,
  type EventName,
  type Harness,
  type Identity,
  type PageStatus,
  type Principal,
  type RunOutcome,
  type RunShape,
  type VerbName,
} from '@uw/contracts';
import { formatDate } from '@uw/core/dates';
import { allowed, isAgent } from '../access.ts';
import type { Caller } from '../caller.ts';
import { accepted, refused, type KernelOutcome } from '../outcome.ts';
import { toolsetOptions } from '../personas/toolset-options.ts';
import type { PageFacts, PersonaDay, RunRow, StoreTransaction } from '../ports.ts';
import { readableHarness, type ScenePorts } from '../reads/scene.ts';
import { refuteNames, refuteSince, refuteTallies } from './refutes.ts';
import { PLANE_LIMIT } from './types.ts';

export type PersonaRunSummary = {
  readonly runId: string;
  readonly itemId: string;
  readonly runShape: RunShape;
  readonly engine: Engine;
  readonly outcome: RunOutcome;
  readonly startedAt: string;
  readonly steps: RunRow['steps'];
};

export type PersonaDashboard = {
  readonly page: {
    readonly id: string;
    readonly title: string;
    readonly status: PageStatus;
    readonly version: number;
    readonly jdArea: string;
  };
  readonly persona: Identity;
  readonly toolset: readonly string[];
  readonly harness: Harness;
  readonly today: string;
  readonly runsToday: {
    readonly total: number;
    readonly byHost: { readonly platform: number; readonly external: number };
    readonly byEngine: Readonly<Partial<Record<Engine, number>>>;
  };
  readonly spend: {
    readonly costMinor: number;
    readonly computeMinor: number;
    readonly currency: 'USD';
    readonly subscriptionTokens: number;
    readonly budgetMinor: number;
  };
  readonly escalation: { readonly ended: number; readonly escalated: number };
  readonly gateRefusals: number;
  readonly premisesHeld: number;
  readonly writes: number;
  readonly approveAt: ApproveAt | null;
  readonly refutes: {
    readonly findings: number;
    readonly refuted: number;
    readonly capped: boolean;
  } | null;
  readonly lastRuns: readonly PersonaRunSummary[];
  readonly delegations: {
    readonly count: number;
    readonly live:
      | readonly {
          readonly id: string;
          readonly personId: string;
          readonly capability: CapabilityWord;
          readonly expiresAt: string;
        }[]
      | null;
  };
  readonly canActivate: boolean;
  readonly toolsetOptions: readonly VerbName[] | null;
};

type Scene = {
  readonly page: PageFacts;
  readonly frontmatter: ReturnType<typeof personaFrontmatterSchema.parse>;
  readonly harness: Harness;
  readonly principal: Principal;
};

const LAST_RUNS = 5;
const SHOWN_DELEGATIONS = 50;
const DAY_MS = 86_400_000;
const counted: readonly EventName[] = [
  'gate_refused_to_agent',
  'checks_failed',
  'premise_held',
  'handed_to_person',
];

function startOfDay(at: Date): Date {
  return new Date(Math.floor(at.getTime() / DAY_MS) * DAY_MS);
}

async function freshPrincipal(ports: ScenePorts, tx: StoreTransaction, caller: Caller, at: Date) {
  const { personId } = caller.actor;
  if (personId === null) return caller.actor;
  return { ...caller.actor, grants: [...(await ports.grants.resolveIn(tx, personId, at))] };
}

async function sceneOf(
  ports: ScenePorts,
  tx: StoreTransaction,
  caller: Caller,
  pageId: string,
  at: Date,
): Promise<Scene | null> {
  const principal = await freshPrincipal(ports, tx, caller, at);
  const [page] = await tx.pages.read.facts([pageId]);
  if (page?.type !== 'persona' || !allowed(principal, 'read', page, at)) return null;
  const parsed = personaFrontmatterSchema.safeParse(page.frontmatter);
  if (!parsed.success) return null;
  const harness = await readableHarness(ports, tx, caller, parsed.data.harness, at);
  return harness === null ? null : { page, frontmatter: parsed.data, harness, principal };
}

function runsToday(day: PersonaDay): PersonaDashboard['runsToday'] {
  const byEngine = new Map<Engine, number>();
  const byHost = { platform: 0, external: 0 };
  for (const { runShape, engine, count } of day.counts) {
    byEngine.set(engine, (byEngine.get(engine) ?? 0) + count);
    if (runShape === 'external-run') byHost.external += count;
    else byHost.platform += count;
  }
  const total = byHost.platform + byHost.external;
  return { total, byHost, byEngine: Object.fromEntries(byEngine) };
}

function summaryOf(run: RunRow): PersonaRunSummary {
  const { id: runId, itemId, runShape, engine, outcome, steps } = run;
  return {
    runId,
    itemId,
    runShape,
    engine,
    outcome,
    startedAt: run.startedAt.toISOString(),
    steps,
  };
}

async function delegationsOf(tx: StoreTransaction, scene: Scene, at: Date) {
  const filter = {
    personId: null,
    persona: scene.frontmatter.identity,
    harnessId: scene.harness.id,
  };
  const count = await tx.delegations.read.countLive(filter, at);
  if (!allowed(scene.principal, 'admin', scene.harness, at)) return { count, live: null };
  const live = await tx.delegations.read.firstLive(filter, at, SHOWN_DELEGATIONS);
  const shown = live.map((delegation) => ({
    id: delegation.id,
    personId: delegation.personId,
    capability: delegation.capability,
    expiresAt: delegation.expiresAt.toISOString(),
  }));
  return { count, live: shown };
}

function abilities(scene: Scene, at: Date) {
  const { principal, page, harness } = scene;
  const person = !isAgent(principal);
  const writes = person && allowed(principal, 'write', page, at);
  const admin = person && allowed(principal, 'admin', harness, at);
  return {
    canActivate: page.status === 'suggested' && writes && admin,
    toolsetOptions: writes ? toolsetOptions(principal, page.jdArea, at) : null,
  };
}

async function figures(tx: StoreTransaction, scene: Scene, since: Date) {
  const identity = scene.frontmatter.identity;
  const harnessId = scene.harness.id;
  const day = await tx.harnessRuns.read.personaDay({ identity, harnessId, since });
  const personaSlug = personaSlugOf(identity) ?? '';
  const events = await tx.harnessEvents.read.countForPersona({
    harnessId,
    personaSlug,
    names: counted,
    since,
  });
  const last = await tx.harnessRuns.read.forPersona({
    identity,
    harnessId,
    since: null,
    limit: LAST_RUNS,
  });
  return { day, events, last };
}

async function refutesOf(
  tx: StoreTransaction,
  scene: Scene,
  at: Date,
): Promise<PersonaDashboard['refutes']> {
  if (scene.frontmatter.capability !== 'review') return null;
  const events = await tx.harnessEvents.read.recent({
    since: refuteSince(at),
    names: refuteNames,
    agentsOnly: false,
    limit: PLANE_LIMIT,
    harnessIds: [scene.harness.id],
  });
  const mine = refuteTallies(events).find((tally) => tally.persona === scene.frontmatter.identity);
  return {
    findings: mine?.findings ?? 0,
    refuted: mine?.refuted ?? 0,
    capped: events.length === PLANE_LIMIT,
  };
}

export async function personaView(
  ports: ScenePorts,
  tx: StoreTransaction,
  caller: Caller,
  pageId: string,
  at: Date,
): Promise<KernelOutcome<PersonaDashboard>> {
  if (isAgent(caller.actor)) return refused('not_permitted', { actor: caller.actor.identity });
  const scene = await sceneOf(ports, tx, caller, pageId, at);
  if (scene === null) return refused('page_not_found', { pageId });
  const since = startOfDay(at);
  const { day, events, last } = await figures(tx, scene, since);
  const counts = (name: EventName) => events.get(name) ?? 0;
  const { page, frontmatter } = scene;
  return accepted({
    page: {
      id: page.id,
      title: page.title,
      status: page.status,
      version: page.version,
      jdArea: page.jdArea,
    },
    persona: frontmatter.identity,
    toolset: frontmatter.toolset,
    harness: scene.harness,
    today: formatDate(since),
    runsToday: runsToday(day),
    spend: {
      costMinor: day.meteredMinor,
      computeMinor: day.computeMinor,
      currency: 'USD',
      subscriptionTokens: day.subscriptionTokens,
      budgetMinor: frontmatter.budget.monthly_minor,
    },
    escalation: { ended: day.ended, escalated: day.escalated + counts('handed_to_person') },
    gateRefusals: counts('gate_refused_to_agent') + counts('checks_failed'),
    premisesHeld: counts('premise_held'),
    writes: day.writes,
    approveAt: frontmatter.capability === 'review' ? frontmatter.approve_at : null,
    refutes: await refutesOf(tx, scene, at),
    lastRuns: last.map(summaryOf),
    delegations: await delegationsOf(tx, scene, at),
    ...abilities(scene, at),
  });
}
