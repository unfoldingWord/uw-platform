import fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eventEvidenceSchemas, type Principal } from '../../packages/contracts/index.ts';
import { closeEmbeddedTemplate } from '../../packages/db/embedded.ts';
import { software, type SubmitInput } from '../../packages/harness/index.ts';
import {
  createSimHarness,
  simAgent,
  simCaller,
  simDelegate,
  simHeldAtCheck,
  simPerson,
} from '../../sim/fixtures.ts';
import { createWorld, type World } from '../../sim/world.ts';

type Actor = { readonly principal: Principal; readonly delegationId: string | null };
type ActorKind = 'device' | 'delegated';
type Setup = {
  readonly world: World;
  readonly harnessId: string;
  readonly admin: Principal;
  readonly actors: ReadonlyMap<ActorKind, Actor>;
};
type Attempt = Omit<SubmitInput, 'itemId'>;
type Case = { readonly attempt: Attempt; readonly actor: ActorKind };

const evidenceSchema = eventEvidenceSchemas.submitted_to_gate.shape.evidence;
const stageKeys = software.stages.map((stage) => stage.key);
const actorKinds: readonly ActorKind[] = ['device', 'delegated'];
const hex = fc.string({
  unit: fc.constantFrom(...'0123456789abcdef'),
  minLength: 1,
  maxLength: 40,
});
const pullRequest = { repo: 'unfoldingWord/uw-platform', number: 7 };
const fixedChange = { pullRequest, head: 'a'.repeat(40) };

const changeArb = fc.option(
  fc.record({
    pullRequest: fc.record({
      repo: fc.constantFrom('unfoldingWord/uw-platform', 'someone/else'),
      number: fc.integer({ min: 1, max: 100_000 }),
    }),
    head: fc.oneof(hex, fc.string({ minLength: 1, maxLength: 64 })),
  }),
  { nil: null },
);

const toArb = fc.oneof(
  { arbitrary: fc.constantFrom(null, 'ship'), weight: 6 },
  { arbitrary: fc.constantFrom(...stageKeys), weight: 2 },
  { arbitrary: fc.string({ maxLength: 40 }), weight: 1 },
);

const caseArb: fc.Arbitrary<Case> = fc.record({
  attempt: fc.record({
    to: toArb,
    evidence: fc
      .dictionary(fc.string({ maxLength: 20 }), fc.jsonValue({ maxDepth: 3 }))
      .map((value) => evidenceSchema.parse(value)),
    change: changeArb,
  }),
  actor: fc.constantFrom(...actorKinds),
});

const examples: [Case][] = actorKinds.flatMap((actor) =>
  [null, 'ship'].flatMap((to) =>
    [null, fixedChange].map((change): [Case] => [{ actor, attempt: { to, evidence: {}, change } }]),
  ),
);

let setup: Setup | null = null;

async function delegated(world: World, owner: Principal, harnessId: string): Promise<Actor> {
  const granted = await simDelegate(world, owner, {
    harnessId,
    persona: 'agent:builder',
    capability: 'build',
    expiresAt: null,
    supersedes: null,
  });
  if (granted.status !== 'accepted') throw new Error(`delegation refused: ${granted.reason}`);
  const device = `${owner.personId ?? ''}/laptop as builder via delegation:${granted.value.id}`;
  const principal = simAgent(owner, device, { interactive: true });
  return { principal, delegationId: granted.value.id };
}

beforeAll(async () => {
  const world = await createWorld();
  const { harness, admin } = await createSimHarness(world, software);
  const owner = await simPerson(world, 2, [
    { role: 'admin', scopeKind: 'jd_area', scopeArea: '80-89' },
  ]);
  const device = simAgent(owner, `${owner.personId ?? ''}/laptop`, { interactive: true });
  const actors = new Map<ActorKind, Actor>([
    ['device', { principal: device, delegationId: null }],
    ['delegated', await delegated(world, owner, harness.id)],
  ]);
  setup = { world, harnessId: harness.id, admin, actors };
});

afterAll(async () => {
  await setup?.world.close();
  await closeEmbeddedTemplate();
});

function required(): Setup {
  if (setup === null) throw new Error('the world was not created');
  return setup;
}

function actorOf(scene: Setup, kind: ActorKind): Actor {
  const actor = scene.actors.get(kind);
  if (actor === undefined) throw new Error(`no actor ${kind}`);
  return actor;
}

async function readItem(scene: Setup, itemId: string) {
  const read = await scene.world.kernel.reads.item(simCaller(scene.world, scene.admin), { itemId });
  if (read.status !== 'accepted') throw new Error(`reading the item was refused: ${read.reason}`);
  return read.value.item;
}

async function releaseIfHeld(scene: Setup, actor: Actor, itemId: string): Promise<void> {
  const item = await readItem(scene, itemId);
  if (item.holder !== actor.principal.identity) return;
  const released = await scene.world.kernel.items.release(simCaller(scene.world, actor.principal), {
    itemId,
    delegationId: actor.delegationId,
  });
  if (released.status !== 'accepted') throw new Error(`release was refused: ${released.reason}`);
}

async function submitOnce(input: Case, run: number): Promise<string> {
  const scene = required();
  const { world, harnessId, admin } = scene;
  const actor = actorOf(scene, input.actor);
  const held = await simHeldAtCheck(world, {
    harnessId,
    admin,
    agent: actor.principal,
    delegationId: actor.delegationId,
    title: `Gate run ${run}`,
  });
  const submitted = await world.kernel.items.submit(simCaller(world, actor.principal), {
    itemId: held.itemId,
    ...input.attempt,
  });
  const result = submitted.status === 'accepted' ? submitted.value.result : submitted.reason;
  expect(result).not.toBe('advanced');
  expect((await readItem(scene, held.itemId)).stageKey).toBe('check');
  await releaseIfHeld(scene, actor, held.itemId);
  return result;
}

function parkedBy(results: readonly (readonly [ActorKind, string])[], kind: ActorKind): number {
  return results.filter(([actor, result]) => actor === kind && result === 'parked').length;
}

describe('AB-4 submit_to_gate has no input that advances past a human gate', () => {
  it('parks or refuses every submission an agent makes at a human-gated stage', async () => {
    const results: (readonly [ActorKind, string])[] = [];
    await fc.assert(
      fc.asyncProperty(caseArb, async (input) => {
        results.push([input.actor, await submitOnce(input, results.length + 1)]);
      }),
      { numRuns: 25, examples },
    );
    for (const kind of actorKinds) {
      expect(parkedBy(results, kind)).toBeGreaterThanOrEqual(examples.length / actorKinds.length);
    }
  });
});
