import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { systemPrincipal } from '@uw/core/principal';
import type { Database } from '@uw/db/client';
import type { Caller, RunStart } from '@uw/harness';
import { platformStore } from '../ports/store.ts';
import { allEvents } from '../testing/commands.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import {
  ended,
  fakeSteps,
  hostRig,
  runDepsFor,
  scriptedEngines,
  startedRun,
} from '../testing/run-host.ts';
import { runWorkflow } from './run-core.ts';

const host: Caller = { actor: systemPrincipal(), traceId: randomUUID(), requestId: null };
const holds = '```harness-scout\npremise: holds\nreason: the plan still stands\n```';

async function checksNotRun(db: Database): Promise<void> {
  const rig = await hostRig(db, host, {});
  const engines = scriptedEngines({
    'openrouter-messages': async () => ended(holds, { resolvedProvider: 'z-ai' }),
    'claude-messages': async () => ended('Fixed.', { outcome: 'checks_not_run_locally' }),
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
  const steps = fakeSteps();
  expect(await runWorkflow(start, steps, runDepsFor(rig, host, engines))).toBe('failed');
  expect(steps.names).not.toContain('submit');
  const run = await platformStore(rig.db).transaction((tx) => tx.harnessRuns.read.byId(runId));
  expect(run).toMatchObject({ outcome: 'failed', failure: 'checks_not_run_locally' });
  const names = (await allEvents(rig.db, rig.harnessId))
    .filter((event) => event.itemId === rig.itemId)
    .map((event) => event.name);
  expect(names).not.toContain('submitted_to_gate');
  expect(names.slice(-2)).toEqual(['run_failed', 'item_released']);
}

describe.skipIf(!testServer)('a fix run that ran no declared checks', () => {
  it('FL-4 the work step answering checks_not_run_locally ends run_failed with it and submits nothing', () =>
    withAppDatabase(checksNotRun));
});
