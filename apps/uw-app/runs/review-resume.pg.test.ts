import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { systemPrincipal } from '@uw/core/principal';
import type { Database } from '@uw/db/client';
import type { Caller, PullRequestFacts, ReviewRequest, RunStart } from '@uw/harness';
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
  type HostRig,
} from '../testing/run-host.ts';
import { runWorkflow } from './run-core.ts';

const host: Caller = { actor: systemPrincipal(), traceId: randomUUID(), requestId: null };
const head = `c0ffee${'0'.repeat(34)}`;
const holds = '```harness-scout\npremise: holds\nreason: the plan still stands\n```';
const verdict = '```harness-verdict\nverdict: approve\n```\n- The change is small and tested.';

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
    closes: [],
    comparison: null,
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

function readModelGets(rig: HostRig, request: ReviewRequest, reviewId: number): void {
  const facts = rig.facts;
  if (facts === null) return;
  const fact = {
    reviewId,
    reviewer: `${request.reviewer}[bot]`,
    commit: request.head,
    state: 'approved' as const,
    provider: 'openai',
    findings: [],
    submittedAt: rig.clock.now(),
  };
  rig.facts = { ...facts, reviews: [...facts.reviews, fact] };
}

function startOf(rig: HostRig, runId: string): RunStart {
  return {
    runId,
    harnessId: rig.harnessId,
    itemId: rig.itemId,
    persona: personaPrincipal(rig).identity,
    runShape: 'workflow-run',
    engine: 'codex-sandbox',
    traceId: randomUUID(),
  };
}

async function reviewPostedOnce(db: Database): Promise<void> {
  const rig = await hostRig(db, host, {
    engine: 'codex-sandbox',
    provider: 'openai',
    capability: 'review',
  });
  await onPullRequest(rig);
  const runId = await startedRun(rig);
  const harness = { harnessId: rig.harnessId, stageKey: null };
  let armed = true;
  rig.afterReview = async (request, reviewId) => {
    readModelGets(rig, request, reviewId);
    if (!armed) return;
    armed = false;
    accepted(await rig.kernel.stages.pause(callerOf(rig.admin), harness));
  };
  const engines = scriptedEngines({
    'openrouter-messages': async () => ended(holds, { resolvedProvider: 'z-ai' }),
    'codex-sandbox': async () =>
      ended(verdict, { resolvedProvider: 'openai', resolvedModel: 'gpt-5.5-codex' }),
  });
  const steps = fakeSteps();
  steps.onWait = async () => {
    accepted(await rig.kernel.stages.resume(callerOf(rig.admin), harness));
    return 'resumed';
  };
  const deps = runDepsFor(rig, host, engines);
  expect(await runWorkflow(startOf(rig, runId), steps, deps)).toBe('reviewed');
  expect(steps.names).toContain('post review again 1');
  expect(rig.reviews).toHaveLength(1);
  const completed = (await allEvents(db, rig.harnessId)).filter(
    (event) => event.name === 'run_completed',
  );
  expect(completed.map((event) => event.evidence)).toMatchObject([
    { result: 'review_posted', review: { reviewer: 'uw-reviewer-codex', reviewId: 9500000001 } },
  ]);
}

describe.skipIf(!testServer)('a review run resumed after its post', () => {
  it('a review run that hibernates after posting and before completing reuses its review after resume', () =>
    withAppDatabase(reviewPostedOnce));
});
