import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { principalSchema, type Engine, type Principal } from '@uw/contracts';
import { systemPrincipal } from '@uw/core/principal';
import type { Database } from '@uw/db/client';
import { seedPage, type SeedPage } from '@uw/db/test-seed';
import {
  scanFences,
  type Caller,
  type Kernel,
  type PullRequestFacts,
  type RunStart,
} from '@uw/harness';
import type { EngineWork, EngineWorkResult } from '../engines/seam.ts';
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
import { readContext } from './bodies.ts';
import { promptSourceOf } from './prompt-source.ts';
import { scoutPrompt } from './prompts.ts';
import { runWorkflow } from './run-core.ts';
import { isOpen, openStep } from './steps.ts';

const host: Caller = { actor: systemPrincipal(), traceId: randomUUID(), requestId: null };
const head = `c0ffee${'0'.repeat(34)}`;
const holds = '```harness-scout\npremise: holds\nreason: the plan still stands\n```';
const verdict = '```harness-verdict\nverdict: approve\n```\n- The change is small.';
const PAGE = {
  item: '00000000-0000-4000-8000-000000013301',
  readable: '00000000-0000-4000-8000-000000013302',
  hidden: '00000000-0000-4000-8000-000000013303',
};

type Ran = { readonly result: string; readonly scouts: string[]; readonly works: string[] };

function startOf(rig: HostRig, runId: string, engine: Engine): RunStart {
  return {
    runId,
    harnessId: rig.harnessId,
    itemId: rig.itemId,
    persona: personaPrincipal(rig).identity,
    runShape: 'workflow-run',
    engine,
    traceId: randomUUID(),
  };
}

async function ranPrompts(rig: HostRig, start: RunStart, answer: EngineWorkResult): Promise<Ran> {
  const scouts: string[] = [];
  const works: string[] = [];
  const worker = async (work: EngineWork) => {
    works.push(work.prompt);
    return answer;
  };
  const engines = scriptedEngines({
    'openrouter-messages': async (work) => {
      scouts.push(work.prompt);
      return ended(holds, { resolvedProvider: 'z-ai' });
    },
    'claude-messages': worker,
    'codex-sandbox': worker,
  });
  const result = await runWorkflow(start, fakeSteps(), runDepsFor(rig, host, engines));
  return { result, scouts, works };
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

async function reviewFenced(db: Database): Promise<void> {
  const rig = await hostRig(db, host, {
    engine: 'codex-sandbox',
    provider: 'openai',
    capability: 'review',
  });
  await onPullRequest(rig);
  const start = startOf(rig, await startedRun(rig), 'codex-sandbox');
  const answer = ended(verdict, { resolvedProvider: 'openai', resolvedModel: 'gpt-5.5-codex' });
  const ran = await ranPrompts(rig, start, answer);
  expect(ran.result).toBe('reviewed');
  const scan = scanFences(ran.works[0] ?? '');
  expect(scan.spans.map((span) => span.source)).toEqual(['page_from_agent', 'pr_diff']);
  expect(scan.spans[1]?.text).toBe('diff --git a/x b/x\n');
  expect(scan.outside).not.toContain('diff --git');
  expect(scan.outside).toContain('Item: Run the hosted Builder');
}

async function buildFenced(db: Database): Promise<void> {
  const rig = await hostRig(db, host, {});
  const start = startOf(rig, await startedRun(rig), 'claude-messages');
  const ran = await ranPrompts(rig, start, ended('done'));
  expect(ran.result).toBe('submitted');
  expect([ran.scouts.length, ran.works.length]).toEqual([1, 1]);
  for (const prompt of [...ran.scouts, ...ran.works]) {
    const scan = scanFences(prompt);
    expect(scan.spans.map((span) => span.source)).toEqual(['page_from_agent']);
    expect(scan.outside).not.toContain('"package"');
    expect(scan.outside).toContain('Item: Run the hosted Builder');
  }
}

describe.skipIf(!testServer)('UC-2 a hosted run fences the outside text it reads', () => {
  it('UC-2 a review run holds the pull request diff only inside a pr_diff fence', () =>
    withAppDatabase(reviewFenced));
  it('UC-2 a build run holds its context only inside a page_from_agent fence, in scout and work', () =>
    withAppDatabase(buildFenced));
});

function page(id: string, title: string, jdArea: string, parentId: string | null): SeedPage {
  return {
    id,
    type: parentId === null ? 'product' : 'product_strategy',
    status: 'active',
    jdArea,
    slug: `uc3-${id.slice(-2)}`,
    title,
    bodyMd: 'Context.',
    frontmatter: {},
    parentId,
  };
}

async function seedItemPages(db: Database): Promise<void> {
  await seedPage(db, page(PAGE.item, 'Board item', '80-89', null));
  await seedPage(db, page(PAGE.readable, 'Readable strategy', '80-89', PAGE.item));
  await seedPage(db, page(PAGE.hidden, 'Hidden budget', '30-39', PAGE.item));
}

function viewerOnly(rig: HostRig): Principal {
  const grant = {
    grantId: randomUUID(),
    role: 'viewer',
    scopeKind: 'jd_area',
    scopeArea: '80-89',
    expiresAt: null,
  };
  return principalSchema.parse({ ...personaPrincipal(rig), grants: [grant] });
}

function seenAs(kernel: Kernel, principal: Principal | null): Kernel {
  if (principal === null) return kernel;
  const scene: Kernel['runs']['scene'] = async (caller, runId) => {
    const found = await kernel.runs.scene(caller, runId);
    return found.status === 'accepted' ? { ...found, value: { ...found.value, principal } } : found;
  };
  return { ...kernel, runs: { ...kernel.runs, scene } };
}

async function contextPrompt(rig: HostRig, runId: string, as: Principal | null): Promise<string> {
  const deps = { ...runDepsFor(rig, host, scriptedEngines({})), runKernel: seenAs(rig.kernel, as) };
  const open = await openStep(deps, runId, null);
  if (!isOpen(open)) throw new Error(`the step did not open: ${JSON.stringify(open)}`);
  try {
    const context = await readContext(open);
    const read = { title: open.scene.item.title, fromIssue: false, context, prompts: [] };
    return scoutPrompt(promptSourceOf(read, rig.itemId));
  } finally {
    await open.close();
  }
}

async function readAsTheRun(db: Database): Promise<void> {
  await seedItemPages(db);
  const rig = await hostRig(db, host, { itemPageId: PAGE.item });
  const runId = await startedRun(rig);
  const scene = accepted(await rig.kernel.runs.scene(host, runId));
  expect(scene.principal).toMatchObject({ identity: 'agent:builder', kind: 'agent' });
  const asTheRun = await contextPrompt(rig, runId, null);
  expect(asTheRun).toContain('Readable strategy');
  expect(asTheRun).toContain('Hidden budget');
  const asViewer = await contextPrompt(rig, runId, viewerOnly(rig));
  expect(asViewer).toContain('Readable strategy');
  expect(asViewer).not.toContain('Hidden budget');
}

describe.skipIf(!testServer)('UC-3 a prompt read carries the run principal', () => {
  it('UC-3 a page the run agent principal may not read is absent from the prompt', () =>
    withAppDatabase(readAsTheRun));
});
