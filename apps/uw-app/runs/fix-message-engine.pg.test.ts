import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { principalSchema, type Principal } from '@uw/contracts';
import { systemPrincipal } from '@uw/core/principal';
import type { Database } from '@uw/db/client';
import { projectSeededPersona, seedPage } from '@uw/db/test-seed';
import type { Caller, PullRequestFacts, RunStart } from '@uw/harness';
import { platformStore } from '../ports/store.ts';
import { accepted, callerOf } from '../testing/commands.ts';
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
const head = `f1ed${'0'.repeat(36)}`;
const fixerPageId = '00000000-0000-4000-8000-000000017101';
const holds = '```harness-scout\npremise: holds\nreason: the plan still stands\n```';
const verdict =
  '```harness-verdict\nverdict: request_changes\n```\n- real: The board drops its empty state.';
const pullRequest = { repo: 'unfoldingWord/uw-platform', number: 7 };

function factsFor(itemId: string): PullRequestFacts {
  return {
    ref: pullRequest,
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

function startOf(rig: HostRig, runId: string, persona: string, engine: RunStart['engine']) {
  const start: RunStart = {
    runId,
    harnessId: rig.harnessId,
    itemId: rig.itemId,
    persona,
    runShape: 'workflow-run',
    engine,
    traceId: randomUUID(),
  };
  return start;
}

async function reviewedRound(rig: HostRig): Promise<void> {
  rig.facts = factsFor(rig.itemId);
  const person = callerOf(rig.admin);
  accepted(await rig.kernel.items.claim(person, { itemId: rig.itemId, delegationId: null }));
  const change = { pullRequest, head };
  accepted(
    await rig.kernel.items.submit(person, { itemId: rig.itemId, to: null, evidence: {}, change }),
  );
  const engines = scriptedEngines({
    'openrouter-messages': async () => ended(holds, { resolvedProvider: 'z-ai' }),
    'codex-sandbox': async () =>
      ended(verdict, { resolvedProvider: 'openai', resolvedModel: 'gpt-5.5-codex' }),
  });
  const runId = await startedRun(rig);
  const start = startOf(rig, runId, personaPrincipal(rig).identity, 'codex-sandbox');
  expect(await runWorkflow(start, fakeSteps(), runDepsFor(rig, host, engines))).toBe('reviewed');
}

function fixerOf(rig: HostRig): Principal {
  return principalSchema.parse({
    identity: 'agent:fixer',
    kind: 'agent',
    personId: rig.admin.personId,
    email: null,
    grants: [],
    interactive: false,
  });
}

async function lentFix(rig: HostRig): Promise<string> {
  const admin = callerOf(rig.admin);
  accepted(await rig.kernel.stages.setFixClaim(admin, { harnessId: rig.harnessId, enabled: true }));
  const granted = accepted(
    await rig.kernel.delegations.grant(admin, {
      maxTier: null,
      harnessId: rig.harnessId,
      persona: 'agent:fixer',
      capability: 'fix',
      expiresAt: null,
      supersedes: null,
    }),
  );
  await seedPage(rig.db, {
    id: fixerPageId,
    type: 'persona',
    status: 'active',
    jdArea: '80-89',
    slug: 'fixer',
    title: 'Fixer',
    bodyMd: 'Fixer repairs what a review found.',
    frontmatter: {
      identity: 'agent:fixer',
      owner: rig.admin.identity,
      harness: rig.harnessId,
      toolset: ['read_page', 'resolve_context', 'record_run_step', 'submit_to_gate'],
      run_shape: 'workflow-run',
      engine: 'claude-messages',
      model: 'claude-sonnet-5',
      provider: null,
      budget: { monthly_minor: 0, currency: 'USD' },
      capability: 'build',
      requires_tools: [],
    },
  });
  await projectSeededPersona(rig.db, fixerPageId);
  return granted.id;
}

async function messageEngineFix(db: Database): Promise<void> {
  const rig = await hostRig(db, host, {
    engine: 'codex-sandbox',
    provider: 'openai',
    capability: 'review',
  });
  await reviewedRound(rig);
  const delegationId = await lentFix(rig);
  const started = accepted(
    await rig.kernel.runs.start(callerOf(fixerOf(rig)), {
      itemId: rig.itemId,
      delegationId,
      personaPageId: fixerPageId,
    }),
  );
  const called: string[] = [];
  const engines = scriptedEngines({
    'openrouter-messages': async () => ended(holds, { resolvedProvider: 'z-ai' }),
    'claude-messages': async (work) => {
      called.push(work.prompt);
      return ended('Fixed.');
    },
  });
  const start = startOf(rig, started.runId, 'agent:fixer', 'claude-messages');
  expect(await runWorkflow(start, fakeSteps(), runDepsFor(rig, host, engines))).toBe('failed');
  expect(called).toEqual([]);
  const run = await platformStore(db).transaction((tx) => tx.harnessRuns.read.byId(started.runId));
  expect(run).toMatchObject({ outcome: 'failed', failure: 'checks_not_run_locally' });
}

describe.skipIf(!testServer)('a fix run on an engine with no fix work spec', () => {
  it('FL-4 a fix on a message engine ends checks_not_run_locally and never calls the engine', () =>
    withAppDatabase(messageEngineFix));
});
