import assert from 'node:assert/strict';
import {
  assistantIdentityOf,
  type AssistantChannel,
  type Harness,
  type HarnessEvent,
  type JdArea,
  type Principal,
  type UntrustedSource,
} from '@uw/contracts';
import { projectSeededPersona, seedPage } from '@uw/db/test-seed';
import {
  assistantPersonaDraft,
  assistantRole,
  readAllEvents,
  runToolLoop,
  type KernelOutcome,
  type LoopResult,
  type ToolCaller,
  type TurnResult,
} from '@uw/harness';
import { readSpend, simCaller, simIngest, simPerson, simRowan, simSystem } from './fixtures.ts';
import { value } from './runs.ts';
import { personOf } from './wakes.ts';
import { simAssistantsArea, type World } from './world.ts';

export const ASSISTANTS_AREA: JdArea = simAssistantsArea;

const assistantPageId = '00000000-0000-4000-8000-000000012001';

type Assistants = World['kernel']['assistants'];
type Begun = Awaited<ReturnType<Assistants['beginTurn']>>;
export type BegunTurn = Extract<Begun, { readonly status: 'accepted' }>['value'];

export type AssistantScene = {
  readonly world: World;
  readonly rowan: Principal;
  readonly person: Principal;
  readonly harness: Harness;
  readonly pageId: string;
};

export type RequestChange = {
  readonly externalId: string;
  readonly note: string;
  readonly channel?: AssistantChannel;
  readonly threadKey?: string | null;
  readonly replyAddress?: string;
  readonly untrustedParts?: readonly { readonly source: UntrustedSource; readonly text: string }[];
};

const refusingTools: ToolCaller = {
  call: async () => ({ output: { error: 'not_wired' }, isError: true }),
};

export function provisionFor(world: World, admin: Principal, person: Principal) {
  return world.kernel.assistants.provision(simCaller(world, admin), {
    harnessId: world.adapters.ids.next(),
    personId: personOf(person),
  });
}

export async function seedAssistantPersona(
  world: World,
  harness: Harness,
  owner: Principal,
  page: { readonly id: string; readonly status: 'active' | 'suggested' } = {
    id: assistantPageId,
    status: 'active',
  },
): Promise<void> {
  const draft = assistantPersonaDraft(harness, owner.identity);
  await seedPage(world.database.db, {
    id: page.id,
    type: 'persona',
    status: page.status,
    jdArea: harness.jdArea,
    slug: draft.slug,
    title: draft.title,
    bodyMd: draft.bodyMd,
    frontmatter: { ...draft.frontmatter, status: page.status },
  });
  await projectSeededPersona(world.database.db, page.id);
}

export function grantAssist(world: World, person: Principal, harnessId: string) {
  return world.kernel.delegations.grant(simCaller(world, person), {
    harnessId,
    persona: assistantIdentityOf(personOf(person)),
    capability: 'assist',
    maxTier: null,
    expiresAt: null,
    supersedes: null,
  });
}

export async function assistantScene(world: World): Promise<AssistantScene> {
  const rowan = await simRowan(world);
  const person = await simPerson(world, 5, [
    { role: 'editor', scopeKind: 'jd_area', scopeArea: '10-19' },
  ]);
  const { harness } = value(await provisionFor(world, rowan, person));
  await seedAssistantPersona(world, harness, rowan);
  world.adapters.directMessages.bind(personOf(person), 'zulip_dm', 'zulip:5005');
  world.adapters.directMessages.bind(personOf(person), 'email', 'p5@example.org');
  return { world, rowan, person, harness, pageId: assistantPageId };
}

export async function grantedScene(world: World): Promise<AssistantScene> {
  const scene = await assistantScene(world);
  value(await grantAssist(world, scene.person, scene.harness.id));
  await readSpend(world);
  return scene;
}

export function recordRequest(scene: AssistantScene, change: RequestChange) {
  return scene.world.kernel.assistants.recordRequest(simCaller(scene.world, simIngest()), {
    personId: personOf(scene.person),
    channel: change.channel ?? 'zulip_dm',
    externalId: change.externalId,
    threadKey: change.threadKey === undefined ? 'dm' : change.threadKey,
    replyAddress: change.replyAddress ?? 'zulip:5005',
    receivedAt: scene.world.adapters.clock.now().toISOString(),
    note: change.note,
    untrustedParts: change.untrustedParts ?? [],
  });
}

export async function requestId(scene: AssistantScene, change: RequestChange): Promise<string> {
  return value(await recordRequest(scene, change)).requestId;
}

export function beginTurn(
  scene: AssistantScene,
  id: string,
  attemptId: string = scene.world.adapters.ids.next(),
): Promise<Begun> {
  return scene.world.kernel.assistants.beginTurn(simCaller(scene.world, simSystem()), {
    requestId: id,
    attemptId,
  });
}

export function replyWith(text: string, costMicros: number | null): TurnResult {
  return {
    text,
    toolCalls: [],
    stopReason: 'end_turn',
    usage: { inputTokens: 120, outputTokens: 12, costMicros, costBasis: 'metered' },
    resolvedProvider: assistantRole.provider,
    resolvedModel: assistantRole.model,
  };
}

export async function finishTurn(
  scene: AssistantScene,
  id: string,
  turn: BegunTurn,
): Promise<LoopResult> {
  const { world } = scene;
  const loop = world.adapters.modelEngine.turn;
  const result = await runToolLoop(loop, refusingTools, turn.loop, async () => undefined);
  value(
    await world.kernel.assistants.finishTurn(simCaller(world, simSystem()), {
      requestId: id,
      turnId: turn.turnId,
      result,
    }),
  );
  return result;
}

export function assistantLog(scene: AssistantScene): Promise<readonly HarnessEvent[]> {
  return scene.world.adapters.store.transaction((tx) => readAllEvents(tx, scene.harness.id, null));
}

export function assistantNames(events: readonly HarnessEvent[]): readonly string[] {
  return events.map((event) => event.name).filter((name) => name.startsWith('assistant_'));
}

export function refusedWhy(outcome: KernelOutcome<unknown>, events: readonly HarnessEvent[]) {
  assert.equal(outcome.status, 'error');
  const refusals = events.filter((event) => event.name === 'assistant_turn_refused');
  return refusals.at(-1)?.evidence['why'];
}
