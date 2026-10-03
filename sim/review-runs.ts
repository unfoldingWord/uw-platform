import { principalSchema } from '@uw/contracts';
import { software, type Caller, type PullRequestRef } from '@uw/harness';
import {
  createSimHarness,
  readSpend,
  simAdvance,
  simAgent,
  simCaller,
  simPerson,
} from './fixtures.ts';
import { builderFrontmatter, seedPersona, systemCaller, value, type RunWorld } from './runs.ts';
import { greenFacts, shipBase, shipPullRequest, simSha } from './ship-fixtures.ts';
import type { World } from './world.ts';

export type ReviewWorld = RunWorld & {
  readonly ref: PullRequestRef;
  readonly head: string;
  readonly runId: string;
  readonly host: Caller;
};

type ReviewSetup = {
  readonly capability?: 'review' | 'build';
  readonly engine?: 'openrouter-messages' | 'claude-messages';
  readonly provider?: string | null;
};

const reviewerPage = '00000000-0000-4000-8000-000000009801';
const reviewer = 'agent:reviewer';
export const reviewHead = simSha('feed');

async function itemAtCheck(scene: Omit<RunWorld, 'itemId' | 'pageId' | 'persona'>) {
  const { world, harnessId, admin } = scene;
  const caller = simCaller(world, admin);
  const { itemId } = value(
    await world.kernel.items.enqueue(caller, {
      harnessId,
      title: 'Review the board change',
      pageId: null,
      priority: 1,
      due: null,
      delegationId: null,
    }),
  );
  await simAdvance(world, { harnessId, itemId, worker: admin, through: ['package'] });
  const agent = simAgent(admin, `${admin.personId ?? ''}/builder`, { interactive: true });
  await simAdvance(world, { harnessId, itemId, worker: agent, through: ['scope', 'plan'] });
  const builder = simCaller(world, agent);
  value(await world.kernel.items.claim(builder, { itemId, delegationId: null }));
  world.adapters.githubFacts.given(greenFacts(world, { itemId, head: reviewHead, reviews: [] }));
  const change = { pullRequest: shipPullRequest, head: reviewHead };
  value(await world.kernel.items.submit(builder, { itemId, to: null, evidence: {}, change }));
  return itemId;
}

async function delegatedReviewer(world: World, capability: 'review' | 'build') {
  const { harness, admin } = await createSimHarness(world, software);
  await readSpend(world);
  const owner = await simPerson(world, 4, [
    { role: 'admin', scopeKind: 'jd_area', scopeArea: '80-89' },
  ]);
  const granted = await world.kernel.delegations.grant(simCaller(world, owner), {
    harnessId: harness.id,
    persona: reviewer,
    capability,
    expiresAt: null,
    supersedes: null,
  });
  return { world, harnessId: harness.id, admin, owner, delegationId: value(granted).id };
}

function personaOf(scene: { readonly owner: RunWorld['owner'] }): RunWorld['persona'] {
  return principalSchema.parse({
    identity: reviewer,
    kind: 'agent',
    personId: scene.owner.personId,
    email: null,
    grants: [],
    interactive: false,
  });
}

export async function reviewWorld(world: World, setup: ReviewSetup = {}): Promise<ReviewWorld> {
  const capability = setup.capability ?? 'review';
  const base = await delegatedReviewer(world, capability);
  const itemId = await itemAtCheck(base);
  await seedPersona(base, {
    id: reviewerPage,
    frontmatter: builderFrontmatter(base, {
      identity: reviewer,
      engine: setup.engine ?? 'openrouter-messages',
      model: 'z-ai/glm-5.3',
      provider: setup.provider === undefined ? 'deepinfra' : setup.provider,
      capability,
      toolset: ['read_page', 'record_run_step'],
    }),
  });
  const scene: RunWorld = { ...base, itemId, pageId: reviewerPage, persona: personaOf(base) };
  const started = await world.kernel.runs.start(simCaller(world, scene.persona), {
    itemId,
    delegationId: scene.delegationId,
    personaPageId: reviewerPage,
  });
  const { runId } = value(started);
  return { ...scene, ref: shipPullRequest, head: reviewHead, runId, host: systemCaller(scene) };
}

export function diffOf(scene: ReviewWorld, text: string): void {
  scene.world.adapters.githubFacts.setDiff(scene.ref, { base: shipBase, head: scene.head }, text);
}
