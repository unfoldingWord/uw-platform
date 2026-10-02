import { ciJobSchema, type ItemState, type Principal } from '@uw/contracts';
import { createLogger, type Logger } from '@uw/core/log';
import type { Database } from '@uw/db/client';
import { seedGrant, seedPerson } from '@uw/db/test-seed';
import {
  readAllEvents,
  software,
  type Caller,
  type Clock,
  type Kernel,
  type KernelOutcome,
} from '@uw/harness';
import { platformGitHubFacts } from '../../ports/github-facts.ts';
import { platformStore } from '../../ports/store.ts';
import { agentOf, kernelOn, personOn } from '../../testing/kernel.ts';
import type { GitHubAppConfig } from '../app-config.ts';
import { createGitHubReads } from '../client.ts';
import { factsFromPull, repoFromRest } from '../facts/normalise.ts';
import { recordFiles, upsertFacts } from '../facts/upsert.ts';
import restPull from '../fixtures/rest-pull.json' with { type: 'json' };
import restReviews from '../fixtures/rest-reviews.json' with { type: 'json' };
import { base, head } from './facts-fixtures.ts';
import { fixtureGitHub, type FixtureGitHub } from './fixture-github.ts';

const ianId = '00000000-0000-4000-8000-000000000001';
const kimId = '00000000-0000-4000-8000-000000000106';
export const instant = new Date('2026-10-02T09:00:00.000Z');
const clock: Clock = { now: () => instant };
export const pullRequest = { repo: 'unfoldingWord/uw-platform', number: 7 };
export const pulls = '/repos/unfoldingWord/uw-platform/pulls/7';
export const movedBase = '1'.repeat(40);
export const oldPaths = ['apps/uw-app/board.tsx'];
export const newPaths = ['packages/db/migrations/0099_board.sql', 'apps/uw-app/board.tsx'];
export const compare = (from: string) =>
  `/repos/unfoldingWord/uw-platform/compare/${from}...${head}`;
function caller(actor: Principal): Caller {
  return { actor, traceId: crypto.randomUUID() };
}

function accepted<T>(outcome: KernelOutcome<T>, what: string): T {
  if (outcome.status !== 'accepted') throw new Error(`${what} was refused: ${outcome.reason}`);
  return outcome.value;
}

async function passStage(kernel: Kernel, worker: Principal, itemId: string, change: boolean) {
  const as = caller(worker);
  accepted(await kernel.items.claim(as, { itemId, delegationId: null }), 'claim');
  const submitted = await kernel.items.submit(as, {
    itemId,
    to: null,
    evidence: {},
    change: change ? { pullRequest, head } : null,
  });
  return accepted(submitted, 'submit').item;
}

async function enqueued(kernel: Kernel, ian: Principal): Promise<string> {
  const harnessId = crypto.randomUUID();
  const repository = pullRequest.repo;
  const harness = { harnessId, harnessKey: 'software', jdArea: '80-89', template: software };
  accepted(await kernel.stages.activate(caller(ian), { ...harness, repository }), 'activate');
  const { itemId } = accepted(
    await kernel.items.enqueue(caller(ian), {
      harnessId,
      title: 'Show the board',
      pageId: null,
      priority: 1,
      due: null,
      delegationId: null,
    }),
    'enqueue',
  );
  return itemId;
}

async function parkAtShip(kernel: Kernel, ian: Principal): Promise<ItemState> {
  const itemId = await enqueued(kernel, ian);
  const agent = agentOf(ian, 'builder');
  await passStage(kernel, ian, itemId, false);
  for (const change of [false, false, true, true]) await passStage(kernel, agent, itemId, change);
  const parked = await passStage(kernel, ian, itemId, false);
  if (parked.stageKey !== 'ship' || parked.gateStatus !== 'parked') {
    throw new Error(`the item is ${parked.gateStatus} at ${parked.stageKey}`);
  }
  return parked;
}

export function pullBasedOn(itemId: string, sha: string, updatedAt: string) {
  const headRef = `harness/${itemId}`;
  return {
    ...restPull,
    updated_at: updatedAt,
    head: { ...restPull.head, ref: headRef, label: `unfoldingWord:${headRef}` },
    base: { ...restPull.base, sha },
  };
}

async function storedOnTheOldBase(db: Database, itemId: string): Promise<void> {
  const pull = pullBasedOn(itemId, base, '2026-10-02T08:00:00Z');
  const repo = repoFromRest(pull.base.repo);
  const batch = repo === null ? null : factsFromPull(repo, pull);
  if (batch === null) throw new TypeError('the fixture pull request is malformed');
  await upsertFacts(db, batch, new Date('2026-10-02T08:00:00.000Z'));
  await recordFiles(db, { pullRequestId: pull.id, head, base, paths: oldPaths, problem: null });
}

function listing(paths: readonly string[]) {
  return { status: 200, body: { status: 'ahead', files: paths.map((filename) => ({ filename })) } };
}

function retargetedOnGitHub(itemId: string): FixtureGitHub {
  const github = fixtureGitHub();
  github.on('GET', pulls, {
    status: 200,
    body: pullBasedOn(itemId, movedBase, '2026-10-02T08:50:00Z'),
  });
  github.on('GET', `${pulls}/reviews`, { status: 200, body: restReviews });
  github.on('GET', `/repos/unfoldingWord/uw-platform/commits/${head}/check-runs`, {
    status: 200,
    body: {
      check_runs: ciJobSchema.options.map((name, index) => ({
        id: 9100000401 + index,
        head_sha: head,
        name,
        status: 'completed',
        conclusion: 'success',
        app: { slug: 'github-actions' },
      })),
    },
  });
  github.on('GET', compare(base), listing(oldPaths));
  github.on('GET', compare(movedBase), listing(newPaths));
  return github;
}

async function people(db: Database) {
  await seedPerson(db, { id: kimId, email: 'person6@unfoldingword.org' });
  await seedGrant(db, {
    id: '00000000-0000-4000-8000-000000020600',
    personId: kimId,
    role: 'admin',
    scopeKind: 'jd_area',
    scopeArea: '80-89',
    grantedAt: new Date('2026-01-01T00:00:00.000Z'),
    expiresAt: null,
  });
  const ian = await personOn(db, ianId, 'ian.lindsley@unfoldingword.org', instant);
  const kim = await personOn(db, kimId, 'person6@unfoldingword.org', instant);
  return { ian, kim };
}

export async function riskAtShip(db: Database, item: ItemState) {
  const events = await platformStore(db).transaction((tx) =>
    readAllEvents(tx, item.harnessId, item.itemId),
  );
  return events.filter((event) => event.name === 'risk_derived').map((event) => event.evidence);
}

type Line = Record<string, unknown>;

function recording(): { readonly logger: Logger; readonly lines: Line[] } {
  const lines: Line[] = [];
  const context = { traceId: crypto.randomUUID(), commit: 'c', route: 'ship' };
  const logger = createLogger({ ...context, principal: null }, (line) =>
    lines.push(JSON.parse(line)),
  );
  return { logger, lines };
}

export async function decisionRows(db: Database, item: ItemState): Promise<number> {
  const rows = await db.$client`
    SELECT count(*)::int AS n FROM gate_decisions WHERE item_id = ${item.itemId}`;
  return Number(rows[0]?.n);
}

export async function attemptShip(
  db: Database,
  app: GitHubAppConfig,
  change: (github: FixtureGitHub, itemId: string) => void = () => undefined,
) {
  const { ian, kim } = await people(db);
  const item = await parkAtShip(kernelOn(db, clock), ian);
  await storedOnTheOldBase(db, item.itemId);
  const github = retargetedOnGitHub(item.itemId);
  change(github, item.itemId);
  const { logger, lines } = recording();
  const open = () => createGitHubReads(app, { fetch: github.fetch, now: clock.now });
  const githubFacts = platformGitHubFacts(db, { open, logger }, clock);
  const decider = kernelOn(db, clock, { githubFacts });
  const decision = { itemId: item.itemId, decision: 'approve' as const, reason: null };
  const outcome = await decider.gates.decide(caller(kim), { ...decision, findings: [] });
  return { outcome, github, lines, item };
}
