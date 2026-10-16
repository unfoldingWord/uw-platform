import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { systemPrincipal } from '@uw/core/principal';
import type { Database } from '@uw/db/client';
import type { Caller, PullRequestFacts, RunStart } from '@uw/harness';
import type { EngineWork } from '../engines/seam.ts';
import { accepted, allEvents, callerOf } from '../testing/commands.ts';
import { seedPullRequest } from '../testing/github-facts.ts';
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
const repository = 'unfoldingWord/uw-platform';
const head = `be11ed${'0'.repeat(34)}`;
const base = '0'.repeat(40);
const holds = '```harness-scout\npremise: holds\nreason: the plan still stands\n```';

function factsFor(itemId: string): PullRequestFacts {
  return {
    ref: { repo: repository, number: 7 },
    state: 'open',
    draft: false,
    head,
    headRef: `harness/${itemId}`,
    headRepo: repository,
    base,
    baseRef: 'main',
    defaultBranch: 'main',
    checks: [],
    reviews: [],
    files: { head, base, paths: ['apps/uw-app/board.tsx'] },
    declaration: null,
    closes: [],
    comparison: null,
    freshAt: new Date(),
  };
}

async function hostedRig(db: Database): Promise<HostRig> {
  const rig = await hostRig(db, host, { engine: 'claude-code-sandbox', provider: 'anthropic' });
  const enabled = { harnessId: rig.harnessId, enabled: true };
  accepted(await rig.kernel.stages.setHostedBuilder(callerOf(rig.admin), enabled));
  await seedPullRequest(db, {
    repoId: 9100000001,
    pullRequestId: 9100000201,
    repo: repository,
    number: 7,
    head,
    headRef: `harness/${rig.itemId}`,
    paths: ['apps/uw-app/board.tsx'],
    freshAt: new Date(),
  });
  rig.facts = factsFor(rig.itemId);
  return rig;
}

async function pullRequestReachesTheItem(db: Database): Promise<void> {
  const rig = await hostedRig(db);
  const works: EngineWork[] = [];
  const engines = scriptedEngines({
    'openrouter-messages': async () =>
      ended(holds, { resolvedProvider: 'z-ai', resolvedModel: 'z-ai/glm-5.3-flash' }),
    'claude-code-sandbox': async (work) => {
      works.push(work);
      return ended('pushed and opened the pull request');
    },
  });
  const runId = await startedRun(rig);
  const start: RunStart = {
    runId,
    harnessId: rig.harnessId,
    itemId: rig.itemId,
    persona: personaPrincipal(rig).identity,
    runShape: 'workflow-run',
    engine: 'claude-code-sandbox',
    traceId: randomUUID(),
  };
  expect(await runWorkflow(start, fakeSteps(), runDepsFor(rig, host, engines))).toBe('submitted');
  const [work] = works;
  expect(work?.checkout).toEqual({
    repository,
    branch: `harness/${rig.itemId}`,
    defaultBranch: 'main',
    expectedHead: null,
    fix: false,
  });
  expect(await work?.egress.github?.token()).toBeNull();
  const events = await allEvents(db, rig.harnessId);
  const submitted = events.find((event) => event.name === 'submitted_to_gate');
  expect(submitted?.evidence).toMatchObject({
    pullRequest: { repo: repository, number: 7 },
    expectedHead: head,
  });
  expect(events.filter((event) => event.name === 'risk_derived')).toHaveLength(1);
}

describe.skipIf(!testServer)("the hosted Builder's pull request", () => {
  it("PE-5 the hosted Builder's open pull request on harness/<item> reaches the item at submit", () =>
    withAppDatabase(pullRequestReachesTheItem));
});
