import { beforeAll, describe, expect, it } from 'vitest';
import {
  ingestEnvelopeSchema,
  itemStateSchema,
  principalSchema,
  type IngestEnvelope,
} from '@uw/contracts';
import { createLogger } from '@uw/core/log';
import type { Database } from '@uw/db/client';
import { reviewBody } from '@uw/harness';
import { assembleShipInput } from '@uw/harness/testing';
import { systemClock } from '../ports/clock.ts';
import { kernelOn } from '../testing/kernel.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import type { GitHubAppConfig } from './app-config.ts';
import { githubClient, type GitHubDeps } from './deps.ts';
import { pullRequestFacts } from './facts/queries.ts';
import pullRequestOpened from './fixtures/pull-request-opened.json' with { type: 'json' };
import reviewSubmitted from './fixtures/pull-request-review-submitted.json' with { type: 'json' };
import restFiles from './fixtures/rest-files.json' with { type: 'json' };
import { githubIngestHandler } from './ingest.ts';
import { fixtureApp, fixtureTransport } from './testing/app-key.ts';
import { base, head } from './testing/facts-fixtures.ts';
import { fixtureGitHub } from './testing/fixture-github.ts';

const ref = { repo: 'unfoldingWord/uw-platform', number: 7 };
const at = new Date('2026-10-02T09:00:00.000Z');
const itemId = 'b1000000-0000-4000-8000-000000000002';
let app: GitHubAppConfig;
let deliveries = 0;

beforeAll(async () => {
  app = await fixtureApp();
});

function envelope(event: string, payload: unknown): IngestEnvelope {
  deliveries += 1;
  return ingestEnvelopeSchema.parse({
    envelopeVersion: 1,
    traceId: crypto.randomUUID(),
    source: 'github',
    deliveryId: `readback-${deliveries}`,
    event,
    receivedAt: '2026-10-02T08:59:00.000Z',
    principal: {
      identity: 'agent:ingest',
      kind: 'agent',
      personId: null,
      email: null,
      grants: [],
      interactive: false,
    },
    payload,
    payloadTruncated: false,
  });
}

function depsOn(db: Database): GitHubDeps {
  const github = fixtureGitHub();
  github.on('GET', `/repos/${ref.repo}/compare/${base}...${head}`, {
    status: 200,
    body: restFiles,
  });
  return {
    db,
    kernel: kernelOn(db, systemClock),
    client: githubClient(app, fixtureTransport(github)),
    now: () => at,
  };
}

async function deliver(deps: GitHubDeps, event: string, payload: unknown): Promise<void> {
  const logger = createLogger(
    { traceId: crypto.randomUUID(), commit: 'c', route: 'queue ingest', principal: 'agent:ingest' },
    () => undefined,
  );
  await githubIngestHandler(deps)(envelope(event, payload), logger);
}

function codexReview() {
  return {
    ...reviewSubmitted,
    review: {
      ...reviewSubmitted.review,
      id: 9100000302,
      user: { login: 'uw-reviewer-codex[bot]', id: 9100000904, type: 'Bot' },
      body: reviewBody({
        provider: 'openai',
        model: 'gpt-5.5-codex',
        verdict: 'approve',
        findings: ['The migration is reversible.'],
      }),
      submitted_at: '2026-10-02T08:20:00Z',
    },
  };
}

const item = itemStateSchema.parse({
  itemId,
  harnessId: 'b1000000-0000-4000-8000-000000000001',
  stageKey: 'ship',
  title: 'Show the board',
  pageId: null,
  priority: 0,
  due: null,
  holder: null,
  claimantKind: null,
  delegationId: null,
  leaseExpiresAt: null,
  gateStatus: 'parked',
  gateTarget: null,
  branchState: 'active',
  expectedHead: head,
  riskTier: 'standard',
  riskDomains: [],
  pullRequest: ref,
  issue: null,
  zulipTopic: null,
});

const approver = principalSchema.parse({
  identity: 'human:00000000-0000-4000-8000-000000000001',
  kind: 'person',
  personId: '00000000-0000-4000-8000-000000000001',
  email: 'ian.lindsley@unfoldingword.org',
  grants: [],
  interactive: true,
});

async function readsBack(db: Database): Promise<void> {
  const deps = depsOn(db);
  await deliver(deps, 'pull_request', pullRequestOpened);
  await deliver(deps, 'pull_request_review', reviewSubmitted);
  await deliver(deps, 'pull_request_review', codexReview());
  const facts = await pullRequestFacts(db, ref);
  expect(facts?.reviews).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ reviewer: 'uw-reviewer-codex[bot]', provider: 'openai' }),
    ]),
  );
  const input = assembleShipInput({
    facts,
    item,
    harness: {
      jdArea: '80-89',
      repository: ref.repo,
      externalReviewerIdentities: [],
      requiredChecks: [],
      frozen: false,
      freezeAllow: [],
    },
    approver,
    at,
    override: false,
  });
  expect(input.approvals).toEqual([
    { reviewer: 'uw-reviewer', commit: head, provider: 'anthropic' },
    { reviewer: 'uw-reviewer-codex', commit: head, provider: 'openai' },
  ]);
}

describe.skipIf(!testServer)('a Reviewer identity review read back from GitHub', () => {
  it('HE-9 a codex review posted on the head is read back from gh_reviews and counts as the second provider', () =>
    withAppDatabase(readsBack));
});
