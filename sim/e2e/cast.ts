import type { CapabilityWord, Principal, Stage } from '@uw/contracts';
import { seedPage } from '@uw/db/test-seed';
import { personaPageDraft, software, templatePersonas, type Caller } from '@uw/harness';
import { createPersonaActivation } from '@uw/harness/persona-activation';
import {
  createSimHarness,
  readSpend,
  simAgent,
  simCaller,
  simPerson,
  simSystem,
} from '../fixtures.ts';
import { personaPrincipal, value, type RunWorld } from '../runs.ts';
import { shipPullRequest, simSha } from '../ship-fixtures.ts';
import type { World } from '../world.ts';

export const minute = 60_000;

export const heads = {
  first: simSha('d7a1'),
  second: simSha('d7b2'),
  pushed: simSha('d7c3'),
} as const;

export const pageIds = {
  builder: '00000000-0000-4000-8000-0000000d7001',
  iterate: '00000000-0000-4000-8000-0000000d7002',
  product: '00000000-0000-4000-8000-0000000d7003',
  learning: '00000000-0000-4000-8000-0000000d7004',
} as const;

const area = { scopeKind: 'jd_area', scopeArea: '80-89' } as const;

type Hosted = {
  readonly identity: 'agent:builder-hosted' | 'agent:iterate';
  readonly delegationId: string;
  readonly pageId: string;
};

export type Cast = {
  readonly world: World;
  readonly harnessId: string;
  readonly stages: readonly Stage[];
  readonly ian: Principal;
  readonly max: Principal;
  readonly kim: Principal;
  readonly laptop: Caller;
  readonly desktop: Caller;
  readonly builder: Hosted;
  readonly iterate: Hosted;
};

export type Journey = {
  readonly cast: Cast;
  readonly itemId: string;
  readonly wrongItemId: string;
};

type PersonaFixture = (typeof templatePersonas.software)[number];

type Hire = {
  readonly fixture: PersonaFixture;
  readonly capability: CapabilityWord;
  readonly pageId: string;
};

type Hiring = { readonly world: World; readonly harnessId: string; readonly owner: Principal };

function fixtureOf(fixtures: readonly PersonaFixture[], slug: string): PersonaFixture {
  const found = fixtures.find((fixture) => fixture.slug === slug);
  if (found === undefined) throw new Error(`the template has no ${slug} persona`);
  return found;
}

async function draftPersona(scene: Hiring, wanted: Hire): Promise<Hosted['identity']> {
  const harness = { id: scene.harnessId, jdArea: area.scopeArea };
  const draft = personaPageDraft(wanted.fixture, harness, scene.owner.identity);
  await seedPage(scene.world.database.db, {
    id: wanted.pageId,
    type: 'persona',
    status: 'suggested',
    jdArea: area.scopeArea,
    slug: draft.slug,
    title: draft.title,
    bodyMd: draft.bodyMd,
    frontmatter: {
      ...draft.frontmatter,
      requires_tools: [...wanted.fixture.toolset],
      status: 'suggested',
    },
  });
  const identity = draft.frontmatter['identity'];
  if (identity !== 'agent:builder-hosted' && identity !== 'agent:iterate') {
    throw new Error(`the drafted persona is ${String(identity)}`);
  }
  return identity;
}

async function hire(scene: Hiring, wanted: Hire): Promise<Hosted> {
  const identity = await draftPersona(scene, wanted);
  const owner = simCaller(scene.world, scene.owner);
  const activation = { pageId: wanted.pageId, expectedVersion: 1, harnessId: scene.harnessId };
  value(await createPersonaActivation(scene.world.adapters).activate(owner, activation));
  const granted = await scene.world.kernel.delegations.grant(simCaller(scene.world, scene.owner), {
    harnessId: scene.harnessId,
    persona: identity,
    capability: wanted.capability,
    expiresAt: null,
    supersedes: null,
  });
  return { identity, delegationId: value(granted).id, pageId: wanted.pageId };
}

async function hireBoth(scene: Hiring): Promise<Pick<Cast, 'builder' | 'iterate'>> {
  const builder = await hire(scene, {
    fixture: fixtureOf(templatePersonas.software, 'builder-hosted'),
    capability: 'build',
    pageId: pageIds.builder,
  });
  const iterate = await hire(scene, {
    fixture: fixtureOf(templatePersonas.bml, 'iterate'),
    capability: 'iterate',
    pageId: pageIds.iterate,
  });
  return { builder, iterate };
}

export async function createCast(world: World): Promise<Cast> {
  const { harness, stages, admin } = await createSimHarness(world, software);
  const max = await simPerson(world, 2, [{ role: 'editor', ...area }]);
  const kim = await simPerson(world, 4, [{ role: 'admin', ...area }]);
  const device = (name: string) =>
    simCaller(world, simAgent(max, `${max.personId ?? ''}/${name}`, { interactive: true }));
  const hosting = { harnessId: harness.id, enabled: true };
  value(await world.kernel.stages.setHostedBuilder(simCaller(world, admin), hosting));
  const hired = await hireBoth({ world, harnessId: harness.id, owner: kim });
  const cast = {
    world,
    harnessId: harness.id,
    stages,
    ian: admin,
    max,
    kim,
    laptop: device('laptop'),
    desktop: device('desktop'),
    ...hired,
  };
  await freshSpend(cast);
  return cast;
}

export function freshSpend(cast: Pick<Cast, 'world'>): Promise<void> {
  return readSpend(cast.world);
}

export function hostedOn(cast: Cast, hosted: Hosted, itemId: string): RunWorld {
  return {
    world: cast.world,
    harnessId: cast.harnessId,
    itemId,
    admin: cast.ian,
    owner: cast.kim,
    delegationId: hosted.delegationId,
    pageId: hosted.pageId,
    persona: personaPrincipal(cast.kim, hosted.identity),
  };
}

export function callerFor(cast: Cast, actor: Principal): Caller {
  return simCaller(cast.world, actor);
}

export function host(cast: Cast): Caller {
  return simCaller(cast.world, simSystem());
}

export function externalStep(cast: Cast, itemId: string) {
  return {
    itemId,
    runId: cast.world.adapters.ids.next(),
    step: 'work' as const,
    tokensIn: 1200,
    tokensOut: 300,
    costBasis: 'subscription' as const,
  };
}

export function changeTo(itemId: string, head: string) {
  return { itemId, to: null, evidence: {}, change: { pullRequest: shipPullRequest, head } };
}
