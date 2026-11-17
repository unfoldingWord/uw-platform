import {
  personaFrontmatterSchema,
  type CapabilityWord,
  type Engine,
  type Harness,
  type Identity,
  type PageStatus,
  type RunShape,
  type Stage,
} from '@uw/contracts';
import { allowed, isAgent } from '../access.ts';
import type { Caller } from '../caller.ts';
import { pageAgrees } from '../delegations/capability.ts';
import { accepted, type KernelOutcome } from '../outcome.ts';
import type { NamedDelegation, PageFacts, StoreTransaction } from '../ports.ts';
import { pickupOpen } from '../reads/poll.ts';
import { harnessScene, type ScenePorts } from '../reads/scene.ts';

export type AgentSummary = {
  readonly pageId: string;
  readonly title: string;
  readonly identity: Identity;
  readonly status: PageStatus;
  readonly runShape: RunShape;
  readonly engine: Engine;
  readonly model: string;
  readonly budgetMinor: number;
  readonly currency: string;
  readonly owner: Identity;
  readonly capability: CapabilityWord;
  readonly reach: readonly string[];
};

export type StandingPermission = NamedDelegation & { readonly agentTitle: string | null };

export type AgentsView = {
  readonly harness: Harness;
  readonly stages: readonly Stage[];
  readonly agents: readonly AgentSummary[];
  readonly permissions: readonly StandingPermission[];
  readonly admin: boolean;
};

const SHOWN_PERMISSIONS = 200;

function reachOf(
  page: PageFacts,
  identity: Identity,
  stages: readonly Stage[],
  permissions: readonly NamedDelegation[],
): readonly string[] {
  if (page.status !== 'active') return [];
  const held = permissions.filter(
    (delegation) => delegation.persona === identity && pageAgrees(page, delegation),
  );
  const reach = new Set<CapabilityWord>(held.map((delegation) => delegation.capability));
  return stages.filter((stage) => pickupOpen(stage, reach)).map((stage) => stage.key);
}

function summaryOf(
  page: PageFacts,
  stages: readonly Stage[],
  permissions: readonly NamedDelegation[],
): AgentSummary | null {
  const parsed = personaFrontmatterSchema.safeParse(page.frontmatter);
  if (!parsed.success) return null;
  const front = parsed.data;
  return {
    pageId: page.id,
    title: page.title,
    identity: front.identity,
    status: page.status,
    runShape: front.run_shape,
    engine: front.engine,
    model: front.model,
    budgetMinor: front.budget.monthly_minor,
    currency: front.budget.currency,
    owner: front.owner,
    capability: front.capability,
    reach: reachOf(page, front.identity, stages, permissions),
  };
}

export async function agentsView(
  ports: ScenePorts,
  tx: StoreTransaction,
  caller: Caller,
  harnessId: string,
  at: Date,
): Promise<KernelOutcome<AgentsView>> {
  const scene = await harnessScene(ports, tx, caller, harnessId, at);
  if (scene.status !== 'accepted') return scene;
  const { harness } = scene.value;
  const stages = [...scene.value.stages].sort((a, b) => a.position - b.position);
  const pages = await tx.pages.read.personasOf(harness.id);
  const named = await tx.delegations.read.liveNamed(harness.id, at, SHOWN_PERMISSIONS);
  const agents = pages.flatMap((page) => summaryOf(page, stages, named) ?? []);
  const titles = new Map(agents.map((agent) => [agent.identity, agent.title]));
  return accepted({
    harness,
    stages,
    agents,
    permissions: named.map((row) => ({ ...row, agentTitle: titles.get(row.persona) ?? null })),
    admin: !isAgent(caller.actor) && allowed(caller.actor, 'admin', harness, at),
  });
}
