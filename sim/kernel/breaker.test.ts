import type { HarnessEvent } from '@uw/contracts';
import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { readAllEvents, software, type Caller } from '@uw/harness';
import { afterAll, describe, expect, it } from 'vitest';
import { createSimHarness, simAgent, simCaller, simPerson } from '../fixtures.ts';
import { readWorldLog } from '../runner/log.ts';
import {
  beatOf,
  detailOf,
  itemEvents,
  itemInScope,
  personaCaller,
  reasonOf,
  runOf,
  runWorld,
  startOn,
  systemCaller,
  value,
  watchingRuns,
  type RunsCalls,
  type RunWorld,
} from '../runs.ts';
import { createWorld } from '../world.ts';

afterAll(closeEmbeddedTemplate);

type Breaking = RunWorld & { readonly calls: RunsCalls; readonly second: string };

const capMinor = 125_000;
const minute = 60_000;
const since = new Date('2026-10-01T00:00:00.000Z');

async function inWorld(work: (scene: Breaking) => Promise<void>): Promise<void> {
  const base = await createWorld();
  try {
    const { world, calls } = watchingRuns(base);
    const scene = await runWorld(world, { spendReading: false });
    const { harness } = await createSimHarness(world, software, { key: 'second' });
    await work({ ...scene, calls, second: harness.id });
    expect((await readWorldLog(base.adapters.store)).drift).toEqual([]);
  } finally {
    await base.close();
  }
}

function spendAt(scene: RunWorld, percent: number): void {
  scene.world.adapters.modelEngine.setSpend({
    spentMinor: (capMinor * percent) / 100,
    currency: 'USD',
  });
}

function check(scene: RunWorld, caller: Caller = systemCaller(scene)) {
  return scene.world.kernel.breaker.check(caller, { capMinor, currency: 'USD', since });
}

async function checkAt(scene: RunWorld, percent: number) {
  spendAt(scene, percent);
  return value(await check(scene));
}

async function breakerEvents(scene: RunWorld, harnessId: string): Promise<HarnessEvent[]> {
  const events = await scene.world.adapters.store.transaction((tx) =>
    readAllEvents(tx, harnessId, null),
  );
  return events.filter((event) => event.name.startsWith('breaker_'));
}

async function breakerNames(scene: Breaking): Promise<readonly (readonly string[])[]> {
  const names = async (harnessId: string) =>
    (await breakerEvents(scene, harnessId)).map((event) => event.name);
  return [await names(scene.harnessId), await names(scene.second)];
}

async function sameLevel(scene: Breaking): Promise<void> {
  const first = await checkAt(scene, 10);
  expect(first).toMatchObject({ level: 'open', previous: 'open', changed: false, percent: 10 });
  expect(await breakerNames(scene)).toEqual([['breaker_open'], ['breaker_open']]);
  scene.world.adapters.clock.advance(4 * minute);
  const again = await checkAt(scene, 12);
  expect(again).toMatchObject({ level: 'open', changed: false, hibernated: [], resumed: [] });
  expect(await breakerNames(scene)).toEqual([['breaker_open'], ['breaker_open']]);
}

async function holding(scene: Breaking): Promise<void> {
  await checkAt(scene, 10);
  const checked = await checkAt(scene, 80);
  expect(checked).toEqual({
    level: 'holding',
    spentMinor: 100_000,
    capMinor,
    currency: 'USD',
    percent: 80,
    previous: 'open',
    changed: true,
    hibernated: [],
    resumed: [],
  });
  const [held] = await breakerEvents(scene, scene.second).then((events) => events.slice(-1));
  expect(held?.evidence).toEqual({ spentMinor: 100_000, capMinor, currency: 'USD', percent: 80 });
  expect(held?.actor).toBe('agent:system');
  expect(await breakerNames(scene)).toEqual([
    ['breaker_open', 'breaker_holding'],
    ['breaker_open', 'breaker_holding'],
  ]);
  const before = (await itemEvents(scene, scene.itemId)).length;
  const refused = await startOn(scene);
  expect(reasonOf(refused)).toBe('spend_held');
  expect(detailOf(refused)).toEqual({ level: 'holding' });
  expect((await itemEvents(scene, scene.itemId)).length).toBe(before);
}

async function pausing(scene: Breaking): Promise<string> {
  await checkAt(scene, 10);
  const { runId } = value(await startOn(scene));
  const checked = await checkAt(scene, 95);
  expect(checked).toMatchObject({ level: 'pausing', changed: true, hibernated: [runId] });
  expect(await runOf(scene.world, runId)).toMatchObject({
    outcome: 'hibernated',
    hibernatedFor: 'breaker',
  });
  const slept = (await itemEvents(scene, scene.itemId)).at(-1);
  expect(slept).toMatchObject({ name: 'run_hibernated', evidence: { runId, why: 'breaker' } });
  expect(scene.calls.hibernate).toEqual([runId]);
  expect(await breakerNames(scene)).toEqual([
    ['breaker_open', 'breaker_pausing'],
    ['breaker_open', 'breaker_pausing'],
  ]);
  return runId;
}

async function reopening(scene: Breaking): Promise<void> {
  const runId = await pausing(scene);
  const checked = await checkAt(scene, 50);
  expect(checked).toMatchObject({ level: 'open', previous: 'pausing', resumed: [runId] });
  expect(await runOf(scene.world, runId)).toMatchObject({
    outcome: 'running',
    hibernatedFor: null,
  });
  expect(scene.calls.resume).toEqual([runId]);
  const itemId = await itemInScope(scene, 'Start after the breaker opens');
  value(await startOn(scene, { itemId }));
}

async function bareClaim(scene: Breaking): Promise<void> {
  await checkAt(scene, 80);
  const beat = await beatOf(scene);
  const before = (await itemEvents(scene, scene.itemId)).length;
  const claim = (caller: Caller) =>
    scene.world.kernel.items.claim(caller, {
      itemId: scene.itemId,
      delegationId: scene.delegationId,
    });
  const refused = await claim(beat);
  expect(reasonOf(refused)).toBe('spend_held');
  expect(detailOf(refused)).toEqual({ level: 'holding' });
  expect((await itemEvents(scene, scene.itemId)).length).toBe(before);
  const editor = await simPerson(scene.world, 6, [
    { role: 'editor', scopeKind: 'jd_area', scopeArea: '80-89' },
  ]);
  const laptop = simCaller(
    scene.world,
    simAgent(editor, `${editor.personId ?? ''}/laptop`, { interactive: true }),
  );
  value(await scene.world.kernel.items.claim(laptop, { itemId: scene.itemId, delegationId: null }));
}

async function subscriptionTokens(scene: Breaking): Promise<void> {
  await checkAt(scene, 70);
  const editor = await simPerson(scene.world, 6, [
    { role: 'editor', scopeKind: 'jd_area', scopeArea: '80-89' },
  ]);
  const laptop = simCaller(
    scene.world,
    simAgent(editor, `${editor.personId ?? ''}/laptop`, { interactive: true }),
  );
  const { items } = scene.world.kernel;
  value(await items.claim(laptop, { itemId: scene.itemId, delegationId: null }));
  const runId = scene.world.adapters.ids.next();
  for (const tokensIn of [4_000_000, 9_000_000]) {
    const step = { itemId: scene.itemId, runId, step: 'work' as const, tokensIn, tokensOut: 1 };
    value(await items.recordRunStep(laptop, { ...step, costBasis: 'subscription' }));
  }
  expect((await runOf(scene.world, runId))?.costMinor).toBeNull();
  const checked = await checkAt(scene, 70);
  expect(checked).toMatchObject({ level: 'open', spentMinor: 87_500, changed: false });
}

async function systemOnly(scene: Breaking): Promise<void> {
  spendAt(scene, 95);
  const callers = [personaCaller(scene), simCaller(scene.world, scene.admin)];
  for (const caller of callers) {
    const refused = await check(scene, caller);
    expect(reasonOf(refused)).toBe('not_permitted');
    expect(detailOf(refused)).toEqual({ actor: caller.actor.identity });
  }
  expect(await breakerNames(scene)).toEqual([[], []]);
}

async function staleReading(scene: Breaking): Promise<void> {
  await checkAt(scene, 10);
  scene.world.adapters.clock.advance(11 * minute);
  const refused = await startOn(scene);
  expect(reasonOf(refused)).toBe('spend_held');
  expect(detailOf(refused)).toEqual({ level: 'open', why: 'no_fresh_reading' });
  const bare = await scene.world.kernel.items.claim(await beatOf(scene), {
    itemId: scene.itemId,
    delegationId: scene.delegationId,
  });
  expect(reasonOf(bare)).toBe('spend_held');
  expect(await checkAt(scene, 10)).toMatchObject({ level: 'open', changed: false });
  expect(await breakerNames(scene)).toEqual([
    ['breaker_open', 'breaker_open'],
    ['breaker_open', 'breaker_open'],
  ]);
  value(await startOn(scene));
}

async function noReading(scene: Breaking): Promise<void> {
  const before = await itemEvents(scene, scene.itemId);
  const refused = await startOn(scene);
  expect(reasonOf(refused)).toBe('spend_held');
  expect(detailOf(refused)).toEqual({ level: 'open', why: 'no_reading' });
  const bare = await scene.world.kernel.items.claim(await beatOf(scene), {
    itemId: scene.itemId,
    delegationId: scene.delegationId,
  });
  expect(reasonOf(bare)).toBe('spend_held');
  expect(await itemEvents(scene, scene.itemId)).toEqual(before);
  value(await check(scene));
  expect(await breakerNames(scene)).toEqual([['breaker_open'], ['breaker_open']]);
  value(await startOn(scene));
}

async function malformed(scene: Breaking): Promise<void> {
  const { breaker } = scene.world.kernel;
  const caller = systemCaller(scene);
  spendAt(scene, 10);
  const attempts = [
    await breaker.check(caller, { capMinor: 0, currency: 'USD', since }),
    await breaker.check(caller, { capMinor: 1.5, currency: 'USD', since }),
    await breaker.check(caller, { capMinor, currency: 'usd', since }),
  ];
  expect(attempts.map(reasonOf)).toEqual([
    'malformed_command',
    'malformed_command',
    'malformed_command',
  ]);
  const otherCurrency = await breaker.check(caller, { capMinor, currency: 'EUR', since });
  expect(reasonOf(otherCurrency)).toBe('malformed_command');
  expect(detailOf(otherCurrency)).toEqual({ why: 'currency' });
  expect(await breakerNames(scene)).toEqual([[], []]);
}

async function stateReads(scene: Breaking): Promise<void> {
  const { breaker } = scene.world.kernel;
  expect(await breaker.state()).toEqual({ level: 'open', reading: null, at: null });
  await checkAt(scene, 80);
  expect(await breaker.state()).toEqual({
    level: 'holding',
    reading: { level: 'holding', spentMinor: 100_000, capMinor, currency: 'USD', percent: 80 },
    at: scene.world.adapters.clock.now().toISOString(),
  });
}

describe('the spend breaker', () => {
  it('HE-5 a reading at the same level within five minutes of the last records nothing', () =>
    inWorld(sameLevel));

  it('HE-5 crossing 75 percent records breaker_holding on every harness and refuses a new hosted start spend_held', () =>
    inWorld(holding));

  it('HE-5 crossing 90 percent records breaker_pausing and hibernates every running hosted run', () =>
    inWorld(async (scene) => {
      await pausing(scene);
    }));

  it("HE-5 falling below 75 percent records breaker_open, resumes the breaker's runs and lets starts through again", () =>
    inWorld(reopening));

  it("HE-5 a bare persona's claim_item is refused spend_held while holding; a device identity's claim is not", () =>
    inWorld(bareClaim));

  it('HE-5 subscription tokens recorded by an external run never move the level', () =>
    inWorld(subscriptionTokens));

  it('HE-5 only the system principal may check the breaker', () => inWorld(systemOnly));

  it("with no reading fresher than ten minutes, a hosted start and a bare persona's claim are refused spend_held", () =>
    inWorld(staleReading));

  it("with no spend reading ever recorded, a hosted start and a bare persona's claim are refused spend_held until a zero reading lands", () =>
    inWorld(noReading));

  it('a cap that is not a positive integer or a currency that is not the reading is malformed', () =>
    inWorld(malformed));

  it('the state is the latest breaker event on any harness, open when there is none', () =>
    inWorld(stateReads));
});
