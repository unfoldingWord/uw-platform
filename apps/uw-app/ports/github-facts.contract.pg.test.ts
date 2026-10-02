import { afterAll, beforeAll, describe } from 'vitest';
import type { PullRequestDeclaration } from '@uw/contracts';
import { createClient, type Database } from '@uw/db/client';
import { createMigratedDatabase, testServer } from '@uw/db/test-database';
import type { CheckFact, PullRequestFacts, ReviewFact } from '@uw/harness';
import { describeGithubFactsContract } from '@uw/harness/port-contracts/github-facts';
import type { GitHubAppConfig } from '../github/app-config.ts';
import { createGitHubReads } from '../github/client.ts';
import {
  checkRunsFromRest,
  factsFromPull,
  repoFromRest,
  reviewsFromRest,
} from '../github/facts/normalise.ts';
import { recordFiles, upsertFacts } from '../github/facts/upsert.ts';
import { fixtureApp } from '../github/testing/app-key.ts';
import { fixtureGitHub, type FixtureGitHub } from '../github/testing/fixture-github.ts';
import { systemClock } from './clock.ts';
import { platformGitHubFacts } from './github-facts.ts';

type Opened = { readonly db: Database; readonly drop: () => Promise<void> };

const opened: Opened[] = [];
const repoIds = new Map<string, number>();
const pullIds = new Map<string, number>();
let app: GitHubAppConfig;
let updates = 0;

beforeAll(async () => {
  app = await fixtureApp();
});

afterAll(async () => {
  for (const { db, drop } of opened) {
    await db.$client.end();
    await drop();
  }
});

function idFor(ids: Map<string, number>, key: string, from: number): number {
  const known = ids.get(key);
  if (known !== undefined) return known;
  const next = from + ids.size;
  ids.set(key, next);
  return next;
}

function bodyOf(declaration: PullRequestDeclaration | null): string | null {
  if (declaration === null) return null;
  const domains =
    declaration.riskDomains.length === 0 ? 'none' : declaration.riskDomains.join(', ');
  return [
    '```harness',
    `closes: ${declaration.closes.length === 0 ? 'none' : declaration.closes.join(', ')}`,
    `risks: ${declaration.risks}`,
    `touches: ${declaration.touches}`,
    `risk_tier: ${declaration.riskTier}`,
    `risk_domains: ${domains}`,
    '```',
  ].join('\n');
}

function restRepository(fullName: string) {
  return {
    id: idFor(repoIds, fullName.toLowerCase(), 9100000001),
    full_name: fullName,
    default_branch: 'main',
    private: true,
  };
}

function restPull(facts: PullRequestFacts, updatedAt: string) {
  const repository = restRepository(facts.ref.repo);
  return {
    id: idFor(pullIds, `${facts.ref.repo.toLowerCase()}#${facts.ref.number}`, 9100000201),
    number: facts.ref.number,
    title: 'Show the board',
    state: facts.state === 'open' ? 'open' : 'closed',
    draft: facts.draft,
    merged: facts.state === 'merged',
    head: { sha: facts.head, ref: facts.headRef, repo: repository },
    base: { sha: facts.base, ref: 'main', repo: repository },
    body: bodyOf(facts.declaration),
    updated_at: updatedAt,
  };
}

function restReview(review: ReviewFact) {
  return {
    id: review.reviewId,
    user: { login: review.reviewer },
    commit_id: review.commit,
    state: review.state.toUpperCase(),
    body:
      review.provider === null
        ? null
        : ['```harness-review', `provider: ${review.provider}`, '```'].join('\n'),
    submitted_at: review.submittedAt?.toISOString() ?? null,
  };
}

function restCheck(check: CheckFact) {
  return {
    id: check.checkId,
    head_sha: check.headSha,
    name: check.name,
    status: check.conclusion === null ? 'in_progress' : 'completed',
    conclusion: check.conclusion,
    app: check.app === null ? null : { slug: check.app },
  };
}

function programme(github: FixtureGitHub, facts: PullRequestFacts, pull: unknown): void {
  const path = `/repos/${facts.ref.repo}/pulls/${facts.ref.number}`;
  github.on('GET', path, { status: 200, body: pull });
  github.on('GET', `${path}/reviews`, { status: 200, body: facts.reviews.map(restReview) });
  github.on('GET', `/repos/${facts.ref.repo}/commits/${facts.head}/check-runs`, {
    status: 200,
    body: { total_count: facts.checks.length, check_runs: facts.checks.map(restCheck) },
  });
}

async function given(db: Database, github: FixtureGitHub, facts: PullRequestFacts) {
  updates += 1;
  const pull = restPull(facts, new Date(Date.UTC(2026, 9, 1, 8, updates)).toISOString());
  programme(github, facts, pull);
  const repo = repoFromRest(pull.base.repo);
  const batch = repo === null ? null : factsFromPull(repo, pull);
  if (repo === null || batch === null) throw new TypeError('the fixture pull request is malformed');
  await upsertFacts(
    db,
    {
      ...batch,
      reviews: reviewsFromRest(repo, pull.id, facts.reviews.map(restReview)),
      checkRuns: checkRunsFromRest(repo.githubId, facts.checks.map(restCheck)),
    },
    facts.freshAt,
  );
  if (facts.files === null) return;
  await recordFiles(db, { pullRequestId: pull.id, ...facts.files, problem: null });
}

describe.skipIf(!testServer)('DX-3 the platform GitHub facts on Postgres', () => {
  describeGithubFactsContract('the platform GitHub facts over the read model', async () => {
    const database = await createMigratedDatabase(testServer ?? '');
    const db = createClient(database.connectionString);
    opened.push({ db, drop: () => database.drop() });
    const github = fixtureGitHub();
    const reads = () => createGitHubReads(app, { fetch: github.fetch, now: systemClock.now });
    return {
      facts: platformGitHubFacts(db, reads, systemClock),
      given: (facts) => given(db, github, facts),
      now: systemClock.now,
    };
  });
});
