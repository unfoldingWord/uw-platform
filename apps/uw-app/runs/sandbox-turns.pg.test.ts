import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { systemPrincipal } from '@uw/core/principal';
import type { Database } from '@uw/db/client';
import type { Caller, RunStart } from '@uw/harness';
import { claudeCodeSandboxEngine } from '../engines/claude-code-sandbox/index.ts';
import type { McpHandler } from '../engines/sandbox/egress.ts';
import type { ExecResult } from '../engines/sandbox/host.ts';
import { fakeContainerHost } from '../engines/sandbox/testing.ts';
import { platformStore } from '../ports/store.ts';
import { accepted, callerOf, eventsNamed } from '../testing/commands.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import {
  ended,
  fakeSteps,
  hostRig,
  personaPrincipal,
  runDepsFor,
  scriptedEngines,
  startedRun,
  type HostRig,
} from '../testing/run-host.ts';
import { runWorkflow } from './run-core.ts';

const host: Caller = { actor: systemPrincipal(), traceId: randomUUID(), requestId: null };
const holds = '```harness-scout\npremise: holds\nreason: the plan still stands\n```';
const SIX_MINUTES = 6 * 60 * 1000;

const result = {
  type: 'result',
  subtype: 'success',
  is_error: false,
  result: 'Built.',
  usage: { input_tokens: 10, output_tokens: 5 },
};

type Session = (egress: McpHandler, rig: HostRig) => Promise<ExecResult>;

function modelCall(): Request {
  return new Request('http://model.internal/v1/messages', { method: 'POST', body: '{}' });
}

async function sandboxRun(db: Database, session: Session) {
  const rig = await hostRig(db, host, { engine: 'claude-code-sandbox', provider: 'anthropic' });
  accepted(
    await rig.kernel.stages.setHostedBuilder(callerOf(rig.admin), {
      harnessId: rig.harnessId,
      enabled: true,
    }),
  );
  const sent: Request[] = [];
  const containers = fakeContainerHost([(egress) => session(egress, rig)]);
  const sandbox = claudeCodeSandboxEngine({
    AI_GATEWAY_ACCOUNT_ID: 'account-1',
    AI_GATEWAY_ID: 'harness-gateway',
    ANTHROPIC_API_KEY: 'organization-key',
    fetch: async (input, init) => {
      sent.push(new Request(input, init));
      return Response.json({ ok: true });
    },
    sandboxes: { claudeCode: containers, codex: null },
    now: () => rig.clock.now(),
  });
  const engines = scriptedEngines({
    'openrouter-messages': async () =>
      ended(holds, { resolvedProvider: 'z-ai', resolvedModel: 'z-ai/glm-5.3-flash' }),
    'claude-code-sandbox': sandbox.work,
  });
  const runId = await startedRun(rig);
  const renewed: string[] = [];
  const items = rig.kernel.items;
  const renewLease: typeof items.renewLease = async (caller, input) => {
    renewed.push(input.itemId);
    return items.renewLease(caller, input);
  };
  const start: RunStart = {
    runId,
    harnessId: rig.harnessId,
    itemId: rig.itemId,
    persona: personaPrincipal(rig).identity,
    runShape: 'workflow-run',
    engine: 'claude-code-sandbox',
    traceId: randomUUID(),
  };
  const deps = runDepsFor(rig, host, engines);
  const verbKernel = { ...rig.kernel, items: { ...items, renewLease } };
  const outcome = await runWorkflow(start, fakeSteps(), { ...deps, verbKernel });
  return { rig, runId, sent, renewed, outcome };
}

function runRow(rig: HostRig, runId: string) {
  return platformStore(rig.db).transaction((tx) => tx.harnessRuns.read.byId(runId));
}

async function leaseRenewed(db: Database): Promise<void> {
  const statuses: number[] = [];
  const r = await sandboxRun(db, async (egress, rig) => {
    statuses.push((await egress(modelCall())).status);
    rig.clock.advance(SIX_MINUTES);
    statuses.push((await egress(modelCall())).status);
    return { exitCode: 0, stdout: JSON.stringify(result), stderr: '' };
  });
  expect(r.outcome).toBe('submitted');
  expect(statuses).toEqual([200, 200]);
  expect(r.renewed).toEqual([r.rig.itemId]);
  expect(await eventsNamed(db, r.rig.harnessId, 'lease_renewed')).toHaveLength(1);
}

async function stoppedMidSession(db: Database): Promise<void> {
  const statuses: number[] = [];
  const r = await sandboxRun(db, async (egress, rig) => {
    statuses.push((await egress(modelCall())).status);
    accepted(await rig.kernel.runs.stop(callerOf(rig.admin), { itemId: rig.itemId }));
    const refused = await egress(modelCall());
    statuses.push(refused.status);
    expect(await refused.text()).toBe('run halted');
    return { exitCode: 0, stdout: JSON.stringify(result), stderr: '' };
  });
  expect(statuses).toEqual([200, 403]);
  expect(r.sent).toHaveLength(1);
  expect(r.outcome).toBe('ended');
  const run = await runRow(r.rig, r.runId);
  expect(run?.outcome).toBe('stopped');
  expect(run?.steps.map((step) => step.step)).toEqual(['read', 'scout']);
}

describe.skipIf(!testServer)('a sandbox step checks the run at every model request', () => {
  it('a sandbox session longer than five minutes renews the lease through its model requests', () =>
    withAppDatabase(leaseRenewed));

  it('HE-1 a sandbox run stopped mid-session refuses its next model request and is aborted', () =>
    withAppDatabase(stoppedMidSession));
});
