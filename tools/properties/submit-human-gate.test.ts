import fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eventEvidenceSchemas, type Principal } from '../../packages/contracts/index.ts';
import { closeEmbeddedTemplate } from '../../packages/db/embedded.ts';
import { software, type SubmitInput } from '../../packages/harness/index.ts';
import {
  createSimHarness,
  simAgent,
  simCaller,
  simHeldAtCheck,
  simPerson,
} from '../../sim/fixtures.ts';
import { createWorld, type World } from '../../sim/world.ts';

type Setup = {
  readonly world: World;
  readonly harnessId: string;
  readonly admin: Principal;
  readonly agent: Principal;
};

type Attempt = Omit<SubmitInput, 'itemId'>;

const evidenceSchema = eventEvidenceSchemas.submitted_to_gate.shape.evidence;
const stageKeys = software.stages.map((stage) => stage.key);
const hex = fc.string({
  unit: fc.constantFrom(...'0123456789abcdef'),
  minLength: 1,
  maxLength: 40,
});

const changeArb = fc.option(
  fc.record({
    pullRequest: fc.record({
      repo: fc.constantFrom('unfoldingWord/uw-platform', 'someone/else'),
      number: fc.integer({ min: 1, max: 100_000 }),
    }),
    head: fc.oneof(hex, fc.string({ minLength: 1, maxLength: 64 })),
    paths: fc.constant([]),
    declaration: fc.constant(null),
  }),
  { nil: null },
);

const attemptArb: fc.Arbitrary<Attempt> = fc.record({
  to: fc.oneof(fc.constantFrom(...stageKeys, null), fc.string({ maxLength: 40 })),
  evidence: fc
    .dictionary(fc.string({ maxLength: 20 }), fc.jsonValue({ maxDepth: 3 }))
    .map((value) => evidenceSchema.parse(value)),
  change: changeArb,
});

let setup: Setup | null = null;

beforeAll(async () => {
  const world = await createWorld();
  const { harness, admin } = await createSimHarness(world, software);
  const owner = await simPerson(world, 2, [
    { role: 'editor', scopeKind: 'jd_area', scopeArea: '80-89' },
  ]);
  const agent = simAgent(owner, `${owner.personId ?? ''}/laptop`, { interactive: true });
  setup = { world, harnessId: harness.id, admin, agent };
});

afterAll(async () => {
  await setup?.world.close();
  await closeEmbeddedTemplate();
});

function required(): Setup {
  if (setup === null) throw new Error('the world was not created');
  return setup;
}

async function readItem(scene: Setup, itemId: string) {
  const read = await scene.world.kernel.reads.item(simCaller(scene.world, scene.admin), { itemId });
  if (read.status !== 'accepted') throw new Error(`reading the item was refused: ${read.reason}`);
  return read.value.item;
}

async function releaseIfHeld(scene: Setup, itemId: string): Promise<void> {
  const item = await readItem(scene, itemId);
  if (item.holder !== scene.agent.identity) return;
  const released = await scene.world.kernel.items.release(simCaller(scene.world, scene.agent), {
    itemId,
    delegationId: null,
  });
  if (released.status !== 'accepted') throw new Error(`release was refused: ${released.reason}`);
}

async function neverAdvances(attempt: Attempt, run: number): Promise<void> {
  const scene = required();
  const { world, harnessId, admin, agent } = scene;
  const held = await simHeldAtCheck(world, { harnessId, admin, agent, title: `Gate run ${run}` });
  const submitted = await world.kernel.items.submit(simCaller(world, agent), {
    itemId: held.itemId,
    ...attempt,
  });
  const result = submitted.status === 'accepted' ? submitted.value.result : submitted.reason;
  expect(result).not.toBe('advanced');
  const after = await readItem(scene, held.itemId);
  expect(after.stageKey).toBe('check');
  await releaseIfHeld(scene, held.itemId);
}

describe('AB-4 submit_to_gate has no input that advances past a human gate', () => {
  it('parks or refuses every submission an agent makes at a human-gated stage', async () => {
    let run = 0;
    await fc.assert(
      fc.asyncProperty(attemptArb, async (attempt) => {
        run += 1;
        await neverAdvances(attempt, run);
      }),
      { numRuns: 25 },
    );
  });
});
