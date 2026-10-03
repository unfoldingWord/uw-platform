import { describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import { kernelOn } from '../testing/kernel.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { callerOf, eventCount, ian, softwareHarness } from '../testing/commands.ts';

async function stageUpdatesVanish(db: Database): Promise<void> {
  await db.$client.unsafe(`
    CREATE FUNCTION test_drop_stage_updates() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      RETURN NULL;
    END
    $$;
    CREATE TRIGGER test_drop_stage_updates BEFORE UPDATE ON harness_stages
      FOR EACH ROW EXECUTE FUNCTION test_drop_stage_updates();
  `);
}

async function lostWritesRefuse(db: Database): Promise<void> {
  const { harnessId } = await softwareHarness(db);
  await stageUpdatesVanish(db);
  const kernel = kernelOn(db, { now: () => new Date() });
  const caller = callerOf(await ian(db));
  const before = await eventCount(db, harnessId);
  const paused = await kernel.stages.pause(caller, { harnessId, stageKey: 'build' });
  expect(paused).toMatchObject({ status: 'error', reason: 'stage_not_found' });
  const renamed = await kernel.stages.updateStage(caller, {
    harnessId,
    stageKey: 'build',
    change: { title: 'Built' },
  });
  expect(renamed).toMatchObject({ status: 'error', reason: 'stage_not_found' });
  expect(await eventCount(db, harnessId)).toBe(before);
}

describe.skipIf(!testServer)('a stage write that changes no row', () => {
  it('a lane pause and a stage update that change no row answer stage_not_found and record nothing, never an internal error', () =>
    withAppDatabase(lostWritesRefuse));
});
