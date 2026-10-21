import { principalSchema, type Principal, type RequiredCheck } from '@uw/contracts';
import {
  checkOnly,
  type Caller,
  type PullRequestFacts,
  type PullRequestRef,
  type ReviewFact,
} from '@uw/harness';
import {
  createSimHarness,
  readSpend,
  simCaller,
  simDelegate,
  simIngest,
  simPerson,
  simSystem,
} from './fixtures.ts';
import { builderFrontmatter, seedPersona, value } from './runs.ts';
import { greenFacts, simSha } from './ship-fixtures.ts';
import type { World } from './world.ts';

export const joinedRepository = 'unfoldingWord/tc-admin-app';
export const joinedPull: PullRequestRef = { repo: joinedRepository, number: 12 };
export const joinedHead = simSha('c0ffee');
const reviewer = 'agent:reviewer';
const reviewerPage = '00000000-0000-4000-8000-000000009901';

export type JoinedWorld = {
  readonly world: World;
  readonly harnessId: string;
  readonly admin: Principal;
  readonly owner: Principal;
  readonly delegationId: string;
  readonly itemId: string;
  readonly persona: Principal;
  readonly ingest: Caller;
  readonly host: Caller;
};

type FactsInput = {
  readonly head?: string;
  readonly reviews?: readonly ReviewFact[];
  readonly ref?: PullRequestRef;
  readonly paths?: readonly string[];
};

export function joinedFacts(world: World, input: FactsInput = {}): PullRequestFacts {
  const head = input.head ?? joinedHead;
  const facts = greenFacts(world, {
    itemId: 'joined',
    head,
    reviews: input.reviews ?? [],
    ref: input.ref ?? joinedPull,
    ...(input.paths === undefined ? {} : { paths: input.paths }),
  });
  return { ...facts, headRef: 'feature/login-form' };
}

type JoinOverrides = {
  readonly pullRequest?: PullRequestRef;
  readonly head?: string;
  readonly title?: string;
  readonly requestedReviewers?: readonly string[];
};

export function joinRequest(world: World, overrides: JoinOverrides = {}) {
  return world.kernel.items.join(simCaller(world, simIngest()), {
    pullRequest: overrides.pullRequest ?? joinedPull,
    head: overrides.head ?? joinedHead,
    title: overrides.title ?? 'Fix the login form',
    requestedReviewers: overrides.requestedReviewers ?? ['uw-reviewer[bot]'],
  });
}

function reviewerPrincipal(owner: Principal): Principal {
  return principalSchema.parse({
    identity: reviewer,
    kind: 'agent',
    personId: owner.personId,
    email: null,
    grants: [],
    interactive: false,
  });
}

type JoinedOptions = {
  readonly shadow: boolean;
  readonly externalReviewerIdentities?: readonly string[];
  readonly requiredChecks?: readonly RequiredCheck[];
  readonly protectedPaths?: readonly string[];
};

function harnessOptionsOf(options: JoinedOptions) {
  return {
    key: 'tc-admin-app',
    repository: joinedRepository,
    shadow: options.shadow,
    externalReviewerIdentities: options.externalReviewerIdentities ?? [],
    ...(options.requiredChecks === undefined ? {} : { requiredChecks: options.requiredChecks }),
    ...(options.protectedPaths === undefined ? {} : { protectedPaths: options.protectedPaths }),
  };
}

export async function joinedWorld(world: World, options: JoinedOptions): Promise<JoinedWorld> {
  const { harness, admin } = await createSimHarness(world, checkOnly, harnessOptionsOf(options));
  await readSpend(world);
  const owner = await simPerson(world, 4, [
    { role: 'admin', scopeKind: 'jd_area', scopeArea: '80-89' },
  ]);
  const granted = await simDelegate(world, owner, {
    harnessId: harness.id,
    persona: reviewer,
    capability: 'review',
    expiresAt: null,
    supersedes: null,
  });
  world.adapters.githubFacts.given(joinedFacts(world));
  const { item } = value(await joinRequest(world));
  const scene = { world, harnessId: harness.id, owner };
  await seedPersona(scene, {
    id: reviewerPage,
    frontmatter: builderFrontmatter(scene, {
      identity: reviewer,
      engine: 'openrouter-messages',
      model: 'z-ai/glm-5.3',
      provider: 'deepinfra',
      capability: 'review',
      toolset: ['read_page', 'record_run_step'],
    }),
  });
  return {
    world,
    harnessId: harness.id,
    admin,
    owner,
    delegationId: value(granted).id,
    itemId: item.itemId,
    persona: reviewerPrincipal(owner),
    ingest: simCaller(world, simIngest()),
    host: simCaller(world, simSystem()),
  };
}

export async function startReview(scene: JoinedWorld): Promise<string> {
  const started = await scene.world.kernel.runs.start(simCaller(scene.world, scene.persona), {
    itemId: scene.itemId,
    delegationId: scene.delegationId,
    personaPageId: reviewerPage,
  });
  return value(started).runId;
}

export const approveVerdict = {
  verdict: 'approve' as const,
  findings: [{ text: 'The form validates as it should.', weight: 'theoretical' as const }],
  resolvedProvider: 'deepinfra',
  resolvedModel: 'z-ai/glm-5.3',
};
