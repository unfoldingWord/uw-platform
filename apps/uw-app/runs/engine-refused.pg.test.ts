import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { systemPrincipal } from '@uw/core/principal';
import type { Database } from '@uw/db/client';
import type { Caller, RunStart } from '@uw/harness';
import { platformStore } from '../ports/store.ts';
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
}

describe.skipIf(!testServer)('GD-3 an engine refusal on the platform host', () => {
  it('GD-3 fails the run engine_refused after one work step and runs it again nowhere', () =>
    withAppDatabase(refusedOnce));
});
