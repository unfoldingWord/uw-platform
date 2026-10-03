import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { VerbName } from '@uw/contracts';
import { systemPrincipal } from '@uw/core/principal';
import type { Database } from '@uw/db/client';
import {
  ProviderMismatchError,
  type Caller,
  type PullRequestFacts,
  type RunStart,
} from '@uw/harness';
import type { EngineWork, EngineWorkResult } from '../engines/seam.ts';
import { platformStore } from '../ports/store.ts';
import { accepted, allEvents, callerOf } from '../testing/commands.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import {
  ended,
  fakeSteps,
  hostRig,
  personaPrincipal,
  runDepsFor,
  scriptedEngines,
  startedRun,
  startRun,
  type HostRig,
  type RigOptions,
  type Script,
} from '../testing/run-host.ts';
import { runWorkflow } from './run-core.ts';

const host: Caller = { actor: systemPrincipal(), traceId: randomUUID(), requestId: null };
const head = `c0ffee${'0'.repeat(34)}`;
const holds = '```harness-scout\npremise: holds\nreason: the plan still stands\n```';
const held = '```harness-scout\npremise: held\nreason: the issue was closed upstream\n```';

type Calls = { scout: number; work: number; works: EngineWork[]; scouts: EngineWork[] };

function scout(calls: Calls, text = holds): Script {
  return async (work) => {
    calls.scout += 1;
    calls.scouts.push(work);
    return ended(text, { resolvedProvider: 'z-ai', resolvedModel: 'z-ai/glm-5.3-flash' });
  };
}

function worker(calls: Calls, body: (work: EngineWork, n: number) => Promise<EngineWorkResult>) {
  return async (work: EngineWork) => {
    calls.work += 1;
    calls.works.push(work);
    return body(work, calls.work);
  };
}

const done = () => Promise.resolve(ended('done'));

async function running(
  db: Database,
  options: RigOptions,
  work: (work: EngineWork, n: number) => Promise<EngineWorkResult> = done,
  scoutText = holds,
) {
  const rig = await hostRig(db, host, options);
  const calls: Calls = { scout: 0, work: 0, works: [], scouts: [] };
  const engines = scriptedEngines({
    'openrouter-messages': scout(calls, scoutText),
    'claude-messages': worker(calls, work),
  });
  const runId = await startedRun(rig);
  const start: RunStart = {
    runId,
    harnessId: rig.harnessId,
    itemId: rig.itemId,
    persona: 'agent:builder',
    runShape: 'workflow-run',
    engine: options.engine ?? 'claude-messages',
    traceId: randomUUID(),
  };
  const steps = fakeSteps();
  const deps = runDepsFor(rig, host, engines);
  return { rig, steps, calls, runId, run: () => runWorkflow(start, steps, deps) };
}

function runRow(rig: HostRig, runId: string) {
  return platformStore(rig.db).transaction((tx) => tx.harnessRuns.read.byId(runId));
}

function itemRow(rig: HostRig) {
  return platformStore(rig.db).transaction((tx) => tx.harnessItems.read.byId(rig.itemId));
}

async function runNames(rig: HostRig): Promise<string[]> {
  const events = await allEvents(rig.db, rig.harnessId);
  return events.filter((event) => event.itemId === rig.itemId).map((event) => event.name);
}

async function namedSteps(db: Database): Promise<void> {
  const r = await running(db, {});
  expect(await r.run()).toBe('submitted');
  expect(r.steps.names).toEqual(['read', 'scout', 'work', 'submit', 'close']);
  const run = await runRow(r.rig, r.runId);
  expect(run?.steps.map((step) => step.step)).toEqual(['read', 'scout', 'work', 'submit']);
  expect(run?.steps.map((step) => step.costMinor)).toEqual([null, 3, 3, null]);
  expect(run).toMatchObject({ outcome: 'completed', costBasis: 'metered' });
}

async function retriedStep(db: Database): Promise<void> {
  const r = await running(db, {}, async (_work, n) => {
    if (n === 1) throw new RangeError('the model host dropped the connection');
    return ended('done');
  });
  expect(await r.run()).toBe('submitted');
  expect(r.calls).toMatchObject({ scout: 1, work: 2 });
  expect(r.steps.names.filter((name) => name === 'read')).toHaveLength(1);
}

async function replayedAfterCrash(db: Database): Promise<void> {
  const r = await running(db, {});
  r.steps.crashAfter = 'scout';
  void r.run();
  await r.steps.crashed;
  expect(r.steps.names).toEqual(['read', 'scout']);
  expect(await r.run()).toBe('submitted');
  expect(r.calls).toMatchObject({ scout: 1, work: 1 });
}

async function exhausted(db: Database): Promise<void> {
  const r = await running(db, {}, () => Promise.reject(new RangeError('always down')));
  expect(await r.run()).toBe('failed');
  expect(r.calls.work).toBe(4);
  expect(await runRow(r.rig, r.runId)).toMatchObject({
    outcome: 'failed',
    failure: 'retries_exhausted',
  });
  expect((await itemRow(r.rig))?.holder).toBeNull();
  const names = await runNames(r.rig);
  expect(names.slice(-2)).toEqual(['run_failed', 'item_released']);
}

async function humanGate(db: Database): Promise<void> {
  const r = await running(db, { gate: true });
  r.steps.onWait = async () => {
    if (r.steps.waits.length < 2) return 'resumed';
    const decided = await r.rig.kernel.gates.decide(callerOf(r.rig.admin), {
      itemId: r.rig.itemId,
      decision: 'approve',
      reason: null,
      findings: [],
      seenHead: null,
    });
    expect(decided.status).toBe('accepted');
    return 'resumed';
  };
  expect(await r.run()).toBe('decided');
  expect(r.steps.waits).toEqual(['wake 1 wait 0', 'wake 1 wait 1']);
  const names = (await runNames(r.rig)).filter((name) => name.startsWith('run_'));
  expect(names.slice(-3)).toEqual(['run_hibernated', 'run_resumed', 'run_completed']);
  expect(await runRow(r.rig, r.runId)).toMatchObject({ outcome: 'completed', gates: ['package'] });
}

async function pausedMidFlight(db: Database): Promise<void> {
  const r: { rig?: HostRig } = {};
  const lane = { harnessId: '', stageKey: 'package' };
  const ran = await running(db, {}, async (work, n) => {
    if (n === 1 && r.rig !== undefined) {
      accepted(await r.rig.kernel.stages.pause(callerOf(r.rig.admin), lane));
      await work.onTurn();
    }
    return ended('done');
  });
  r.rig = ran.rig;
  lane.harnessId = ran.rig.harnessId;
  ran.steps.onWait = async () => {
    accepted(await ran.rig.kernel.stages.resume(callerOf(ran.rig.admin), lane));
    return 'resumed';
  };
  expect(await ran.run()).toBe('submitted');
  expect(ran.calls.work).toBe(2);
  expect(ran.steps.names).toContain('work again 1');
  const names = (await runNames(ran.rig)).filter((name) => name.startsWith('run_'));
  expect(names).toContain('run_hibernated');
  expect(names).toContain('run_resumed');
}

async function runRecord(db: Database): Promise<void> {
  const r = await running(db, {}, async (work) => {
    await work.tools.call('search_pages', { query: 'board', type: null, limit: 5 });
    await work.tools.call('submit_to_gate', {});
    return ended('done', { toolsCalled: ['search_pages', 'submit_to_gate'] });
  });
  await r.run();
  const run = await runRow(r.rig, r.runId);
  const work = run?.steps.find((step) => step.step === 'work');
  expect(work).toMatchObject({
    tokensIn: 120,
    tokensOut: 30,
    costMinor: 3,
    model: 'claude-sonnet-5',
    resolvedProvider: 'anthropic',
    toolsCalled: ['search_pages', 'submit_to_gate'],
    writes: 1,
  });
  expect(run).toMatchObject({
    model: 'claude-sonnet-5',
    costMinor: 6,
    gates: ['package'],
    outcome: 'completed',
  });
  expect((run?.endedAt?.getTime() ?? 0) >= (run?.startedAt.getTime() ?? 1)).toBe(true);
  const events = (await allEvents(r.rig.db, r.rig.harnessId)).filter(
    (event) => event.itemId === r.rig.itemId,
  );
  const fromStart = events.slice(events.findIndex((event) => event.name === 'run_started'));
  expect(new Set(fromStart.map((event) => event.traceId))).toEqual(new Set([run?.traceId]));
}

async function personaTools(db: Database): Promise<void> {
  const toolset: VerbName[] = ['read_page', 'record_run_step', 'submit_to_gate', 'write_page'];
  const r = await running(db, { toolset });
  await r.run();
  expect(r.calls.works[0]?.toolset).toEqual(['read_page', 'submit_to_gate', 'write_page']);
  expect(r.calls.scouts[0]?.toolset).toEqual(['read_page']);
}

function factsFor(itemId: string): PullRequestFacts {
  return {
    ref: { repo: 'unfoldingWord/uw-platform', number: 7 },
    state: 'open',
    draft: false,
    head,
    headRef: `harness/${itemId}`,
    headRepo: 'unfoldingWord/uw-platform',
    base: '0'.repeat(40),
    baseRef: 'main',
    defaultBranch: 'main',
    checks: [],
    reviews: [],
    files: null,
    declaration: null,
    freshAt: new Date(),
  };
}

async function onPullRequest(rig: HostRig): Promise<void> {
  rig.facts = factsFor(rig.itemId);
  const person = callerOf(rig.admin);
  accepted(await rig.kernel.items.claim(person, { itemId: rig.itemId, delegationId: null }));
  const change = { pullRequest: { repo: 'unfoldingWord/uw-platform', number: 7 }, head };
  accepted(
    await rig.kernel.items.submit(person, { itemId: rig.itemId, to: null, evidence: {}, change }),
  );
}

async function mismatch(db: Database): Promise<void> {
  const rig = await hostRig(db, host, {
    engine: 'openrouter-messages',
    provider: 'deepinfra',
    capability: 'review',
  });
  await onPullRequest(rig);
  const runId = await startedRun(rig);
  const engines = scriptedEngines({
    'openrouter-messages': async (work) => {
      if (work.prompt.includes('```harness-scout')) {
        return ended(holds, { resolvedProvider: 'deepinfra' });
      }
      throw new ProviderMismatchError('deepinfra', 'together');
    },
  });
  const start: RunStart = {
    runId,
    harnessId: rig.harnessId,
    itemId: rig.itemId,
    persona: personaPrincipal(rig).identity,
    runShape: 'workflow-run',
    engine: 'openrouter-messages',
    traceId: randomUUID(),
  };
  expect(await runWorkflow(start, fakeSteps(), runDepsFor(rig, host, engines))).toBe('failed');
  expect(await runRow(rig, runId)).toMatchObject({
    outcome: 'failed',
    failure: 'provider_mismatch',
  });
  const failed = (await allEvents(db, rig.harnessId)).find((event) => event.name === 'run_failed');
  expect(failed?.evidence).toMatchObject({
    why: 'provider_mismatch',
    detail: 'deepinfra/together',
  });
  expect(rig.reviews).toEqual([]);
}

async function heldPremise(db: Database): Promise<void> {
  const r = await running(db, {}, done, held);
  expect(await r.run()).toBe('premise_held');
  expect(r.calls.work).toBe(0);
  expect(r.steps.names).not.toContain('work');
  const names = await runNames(r.rig);
  expect(names.slice(-3)).toEqual(['premise_held', 'item_released', 'run_completed']);
}

async function gateExpires(db: Database): Promise<void> {
  const r = await running(db, { gate: true });
  expect(await r.run()).toBe('gate_wait_expired');
  expect(r.steps.waits).toHaveLength(720);
  const stopped = (await allEvents(db, r.rig.harnessId)).find(
    (event) => event.name === 'run_stopped',
  );
  expect(stopped?.evidence).toEqual({ runId: r.runId, why: 'gate_wait_expired' });
}

async function hostedBuilderOnly(db: Database): Promise<void> {
  const rig = await hostRig(db, host, { engine: 'claude-code-sandbox', provider: 'anthropic' });
  expect(await startRun(rig)).toMatchObject({
    status: 'error',
    reason: 'hosted_builder_off',
  });
  const enabled = { harnessId: rig.harnessId, enabled: true };
  accepted(await rig.kernel.stages.setHostedBuilder(callerOf(rig.admin), enabled));
  const calls: Calls = { scout: 0, work: 0, works: [], scouts: [] };
  const engines = scriptedEngines({
    'openrouter-messages': scout(calls),
    'claude-code-sandbox': worker(calls, async () => ended('built', { computeMinor: 12 })),
  });
  const runId = await startedRun(rig);
  const begun: RunStart = {
    runId,
    harnessId: rig.harnessId,
    itemId: rig.itemId,
    persona: personaPrincipal(rig).identity,
    runShape: 'workflow-run',
    engine: 'claude-code-sandbox',
    traceId: randomUUID(),
  };
  expect(await runWorkflow(begun, fakeSteps(), runDepsFor(rig, host, engines))).toBe('submitted');
  expect(calls.works.map((work) => typeof work.egress.mcp)).toEqual(['function']);
  const work = (await runRow(rig, runId))?.steps.find((step) => step.step === 'work');
  expect(work).toMatchObject({ computeMinor: 12, resolvedProvider: 'anthropic' });
}

describe.skipIf(!testServer)('the run core', () => {
  it('HE-1 a run records read, scout, work and submit as named steps, each through record_run_step with its cost', () =>
    withAppDatabase(namedSteps));

  it('HE-1 a step that fails is retried from that step without re-running the steps before it', () =>
    withAppDatabase(retriedStep));

  it('HE-1 a run replayed after a crash between steps resumes from the last checkpoint', () =>
    withAppDatabase(replayedAfterCrash));

  it("HE-1 a run that exhausts a step's retries is recorded failed and its item released", () =>
    withAppDatabase(exhausted));

  it('HE-1 at a human gate the run submits, hibernates, and resumes only when a person decides', () =>
    withAppDatabase(humanGate));

  it('HE-1 a run paused mid-flight waits and continues after resume', () =>
    withAppDatabase(pausedMidFlight));

  it('HE-1 the run record carries the trace id, model, tokens, cost, duration, tools called, writes, gates and outcome', () =>
    withAppDatabase(runRecord));

  it("HE-3 the tools offered to the model are exactly the persona's toolset", () =>
    withAppDatabase(personaTools));

  it('HE-4 a provider mismatch fails the run provider_mismatch and posts no review', () =>
    withAppDatabase(mismatch));

  it('HE-8 a Builder on claude-code-sandbox runs only where hosted Builder is on', () =>
    withAppDatabase(hostedBuilderOnly));

  it('HE-1 a held premise ends the run without a work step', () => withAppDatabase(heldPremise));

  it('HE-1 a gate left undecided for 30 days stops the run gate_wait_expired', () =>
    withAppDatabase(gateExpires));
});
