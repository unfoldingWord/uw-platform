import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { systemPrincipal } from '@uw/core/principal';
import type { Database } from '@uw/db/client';
import type { Caller, RunStart } from '@uw/harness';
import { platformStore } from '../ports/store.ts';
import { accepted } from '../testing/commands.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import {
  ended,
  fakeSteps,
  hostRig,
  type HostRig,
  runDepsFor,
  scriptedEngines,
  startedRun,
} from '../testing/run-host.ts';
import { runWorkflow } from './run-core.ts';

const host: Caller = { actor: systemPrincipal(), traceId: randomUUID(), requestId: null };
const holds = '```harness-scout\npremise: holds\nreason: the plan still stands\n```';

async function refusedOnce(db: Database): Promise<void> {
  const rig = await hostRig(db, host, {});
  const worked: string[] = [];
  const engines = scriptedEngines({
    'openrouter-messages': async () =>
      ended(holds, { resolvedProvider: 'z-ai', resolvedModel: 'z-ai/glm-5.3-flash' }),
    'claude-messages': async (work) => {
      worked.push(work.runId);
      return ended('I will not do this.', { outcome: 'refused' });
    },
  });
  const runId = await startedRun(rig);
  const start: RunStart = {
    runId,
    harnessId: rig.harnessId,
    itemId: rig.itemId,
    persona: 'agent:builder',
    runShape: 'workflow-run',
    engine: 'claude-messages',
    traceId: randomUUID(),
  };
  expect(await runWorkflow(start, fakeSteps(), runDepsFor(rig, host, engines))).toBe('failed');
  const run = await platformStore(rig.db).transaction((tx) => tx.harnessRuns.read.byId(runId));
  expect(run).toMatchObject({ outcome: 'failed', failure: 'engine_refused' });
  expect(worked).toEqual([runId]);
  await handedAndNeverRetried(rig);
}

const DAY_MS = 24 * 3_600_000;

async function handedAndNeverRetried(rig: HostRig): Promise<void> {
  const store = platformStore(rig.db);
  const query = {
    since: new Date(0),
    names: ['handed_to_person' as const],
    agentsOnly: false,
    limit: 10,
    harnessIds: [rig.harnessId],
  };
  const handed = await store.transaction((tx) => tx.harnessEvents.read.recent(query));
  const personId = rig.admin.personId ?? '';
  expect(handed.map((event) => event.evidence)).toEqual([
    { personId, why: 'engine_refused', rounds: null },
  ]);
  const item = await store.transaction((tx) => tx.harnessItems.read.byId(rig.itemId));
  expect(item?.holder).toBe(`human:${personId}`);
  rig.clock.advance(2 * DAY_MS);
  const since = rig.clock.now();
  accepted(await rig.kernel.breaker.check(host, { capMinor: 125_000, currency: 'USD', since }));
  expect(accepted(await rig.kernel.runs.beat(host, { limit: 10 }))).toEqual({
    started: [],
    skipped: [],
  });
}

describe.skipIf(!testServer)('GD-3 an engine refusal on the platform host', () => {
  it('GD-3 fails the run engine_refused, hands the item to the grantor and starts no second run after the backoff', () =>
    withAppDatabase(refusedOnce));
});
