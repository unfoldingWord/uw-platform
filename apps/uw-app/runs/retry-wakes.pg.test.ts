import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { systemPrincipal } from '@uw/core/principal';
import type { Database } from '@uw/db/client';
import type { Caller, Notifier, RunStart, Wake } from '@uw/harness';
import type { EngineWorkResult } from '../engines/seam.ts';
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

type Work = (attempt: number) => Promise<EngineWorkResult>;

function recordingNotifier(wakes: Wake[]): Notifier {
  return {
    notify: async (wake) => {
      wakes.push(wake);
      return { push: [], zulip: 'not_posted' };
    },
  };
}

async function hostedRun(db: Database, work: Work) {
  const wakes: Wake[] = [];
  const rig = await hostRig(db, host, { notifier: recordingNotifier(wakes) });
  let attempts = 0;
  const engines = scriptedEngines({
    'openrouter-messages': async () =>
      ended(holds, { resolvedProvider: 'z-ai', resolvedModel: 'z-ai/glm-5.3-flash' }),
    'claude-messages': async () => {
      attempts += 1;
      return work(attempts);
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
  const before = wakes.length;
  const outcome = await runWorkflow(start, fakeSteps(), runDepsFor(rig, host, engines));
  return { rig, outcome, attempts, wakes: wakes.slice(before) };
}

function reasons(wakes: readonly Wake[]): readonly string[] {
  return wakes.map((wake) => wake.reason);
}

function reasonsOf(run: Awaited<ReturnType<typeof hostedRun>>) {
  return { outcome: run.outcome, attempts: run.attempts, reasons: reasons(run.wakes) };
}

async function retriedStepSendsNothing(): Promise<void> {
  const clean = await withAppDatabase(async (db) =>
    reasonsOf(await hostedRun(db, () => Promise.resolve(ended('done')))),
  );
  const retried = await withAppDatabase(async (db) =>
    reasonsOf(
      await hostedRun(db, async (attempt) => {
        if (attempt < 3) throw new RangeError('the model host dropped the connection');
        return ended('done');
      }),
    ),
  );
  expect(clean.outcome).toBe('submitted');
  expect(retried).toMatchObject({ outcome: 'submitted', attempts: 3 });
  expect(retried.reasons).toEqual(clean.reasons);
  expect(retried.reasons).not.toContain('run_failed');
}

async function finalFailureWakesOnce(db: Database): Promise<void> {
  const failed = await hostedRun(db, () => Promise.reject(new RangeError('always down')));
  expect(failed).toMatchObject({ outcome: 'failed', attempts: 4 });
  const runFailed = failed.wakes.filter((wake) => wake.reason === 'run_failed');
  expect(runFailed.map((wake) => wake.recipients.map((r) => r.personId))).toEqual([
    [failed.rig.admin.personId],
  ]);
}

describe.skipIf(!testServer)('the run host and the Workflow retries', () => {
  it('NT-4 a Workflow step that fails and is retried sends no wake a clean run does not send', () =>
    retriedStepSendsNothing());

  it('NT-4 a run that fails finally after the Workflow retries wakes its holder once', () =>
    withAppDatabase(finalFailureWakesOnce));
});
