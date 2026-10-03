import { randomUUID } from 'node:crypto';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { systemPrincipal } from '@uw/core/principal';
import type { Database } from '@uw/db/client';
import type { Caller } from '@uw/harness';
import type { RunStepConnection } from '../mcp/in-process.ts';
import { accepted, callerOf, eventsNamed } from '../testing/commands.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import {
  hostRig,
  runDepsFor,
  scriptedEngines,
  startedRun,
  type HostRig,
} from '../testing/run-host.ts';
import { isOpen, openStep, type OpenStep } from './steps.ts';

const host: Caller = { actor: systemPrincipal(), traceId: randomUUID(), requestId: null };

async function opened(rig: HostRig, runId: string): Promise<OpenStep> {
  const step = await openStep(runDepsFor(rig, host, scriptedEngines({})), runId, null);
  if (!isOpen(step)) throw new Error(`the step did not open: ${step.kind}`);
  return step;
}

function recordStep(step: OpenStep, costBasis: 'metered' | 'subscription') {
  return step.core.callTool({
    name: 'record_run_step',
    arguments: {
      itemId: step.scene.item.itemId,
      runId: step.scene.run.id,
      step: 'read',
      tokensIn: 0,
      tokensOut: 0,
      costBasis,
    },
  });
}

async function beatPrincipal(db: Database): Promise<void> {
  const rig = await hostRig(db, host);
  const runId = await startedRun(rig);
  expectTypeOf<RunStepConnection>().not.toHaveProperty('principal');
  const step = await opened(rig, runId);
  try {
    expect(step.scene.principal).toMatchObject({
      identity: 'agent:builder',
      kind: 'agent',
      personId: rig.admin.personId,
    });
    expect(step.scene.run.id).toBe(runId);
  } finally {
    await step.close();
  }
}

async function personaToolset(db: Database): Promise<void> {
  const rig = await hostRig(db, host);
  const step = await opened(rig, await startedRun(rig));
  try {
    const listed = await step.client.listTools();
    expect(listed.tools.map((tool) => tool.name).sort()).toEqual(
      ['read_page', 'resolve_context', 'search_pages', 'submit_to_gate'].sort(),
    );
    const outside = await step.client.callTool({ name: 'record_run_step', arguments: {} }).then(
      () => null,
      (error: unknown) => error,
    );
    expect(outside instanceof Error ? outside.message : '').toContain(
      'Unknown tool: record_run_step',
    );
  } finally {
    await step.close();
  }
}

async function ownInstant(db: Database): Promise<void> {
  const rig = await hostRig(db, host);
  const runId = await startedRun(rig);
  const first = await opened(rig, runId);
  await recordStep(first, 'metered');
  await first.close();
  rig.clock.advance(90_000);
  const second = await opened(rig, runId);
  await recordStep(second, 'metered');
  await second.close();
  const recorded = await eventsNamed(db, rig.harnessId, 'run_step_recorded');
  const times = recorded.map((event) => new Date(event.at).getTime());
  expect(times).toHaveLength(2);
  expect((times[1] ?? 0) - (times[0] ?? 0)).toBe(90_000);
  expect(recorded.map((event) => event.traceId)).toEqual([
    first.scene.run.traceId,
    first.scene.run.traceId,
  ]);
}

async function meteredOnly(db: Database): Promise<void> {
  const rig = await hostRig(db, host);
  const step = await opened(rig, await startedRun(rig));
  try {
    const refused = await recordStep(step, 'subscription');
    expect(refused.isError).toBe(true);
    expect(JSON.stringify(refused.content)).toContain('cost_basis_is_the_hosts');
    const taken = await recordStep(step, 'metered');
    expect(taken.isError).not.toBe(true);
  } finally {
    await step.close();
  }
  const [recorded] = await eventsNamed(db, rig.harnessId, 'run_step_recorded');
  expect(recorded?.evidence).toMatchObject({ step: 'read', costBasis: 'metered' });
}

async function lapsedDelegation(db: Database): Promise<void> {
  const rig = await hostRig(db, host);
  const runId = await startedRun(rig);
  accepted(
    await rig.kernel.delegations.revoke(callerOf(rig.admin), { delegationId: rig.delegationId }),
  );
  const step = await openStep(runDepsFor(rig, host, scriptedEngines({})), runId, null);
  expect(step).toEqual({ kind: 'ended' });
  const [stopped] = await eventsNamed(db, rig.harnessId, 'run_stopped');
  expect(stopped?.evidence).toEqual({ runId, why: 'delegation_lapsed' });
}

async function stoppedMidStep(db: Database): Promise<void> {
  const rig = await hostRig(db, host);
  const runId = await startedRun(rig);
  const step = await opened(rig, runId);
  try {
    accepted(await rig.kernel.runs.stop(callerOf(rig.admin), { itemId: rig.itemId }));
    const call = await step.client.callTool({
      name: 'search_pages',
      arguments: { query: 'board', type: null, limit: 5 },
    });
    expect(call.isError).toBe(true);
    expect(JSON.stringify(call.content)).toContain('run_stopped');
  } finally {
    await step.close();
  }
}

describe.skipIf(!testServer)('the step connection', () => {
  it("HE-1 a step connects as the run's beat principal and never as a principal it is given", () =>
    withAppDatabase(beatPrincipal));

  it("HE-3 a step's server lists and serves exactly the persona's toolset, without record_run_step", () =>
    withAppDatabase(personaToolset));

  it('HE-1 each step opens its own connection at its own instant', () =>
    withAppDatabase(ownInstant));

  it('HE-1 record_run_step from a step is metered and a subscription basis is refused', () =>
    withAppDatabase(meteredOnly));

  it('HE-1 a step for a run whose delegation lapsed opens no connection', () =>
    withAppDatabase(lapsedDelegation));

  it("a tool call after a person stopped the run is refused by the step's per-call check", () =>
    withAppDatabase(stoppedMidStep));
});
