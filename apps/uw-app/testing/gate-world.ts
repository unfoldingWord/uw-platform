import { randomUUID } from 'node:crypto';
import { ciJobSchema, type ItemState, type Principal } from '@uw/contracts';
import type { Database } from '@uw/db/client';
import { seedEventRows, seedGrant, seedPerson } from '@uw/db/test-seed';
import { reviewBody } from '@uw/harness';
import { checkRunsFromRest, repoFromRest, reviewsFromRest } from '../github/facts/normalise.ts';
import { emptyBatch } from '../github/facts/records.ts';
import { upsertFacts } from '../github/facts/upsert.ts';
import restPull from '../github/fixtures/rest-pull.json' with { type: 'json' };
import restReviews from '../github/fixtures/rest-reviews.json' with { type: 'json' };
import { head } from '../github/testing/facts-fixtures.ts';
import { kimEmail, parkedAtShip } from '../github/testing/gate-rig.ts';

const reviewerFindings = [
  { text: 'The lease is not renewed', weight: 'real' as const },
  { text: 'A typo in the copy', weight: 'theoretical' as const },
];
const storedAt = new Date('2026-10-02T08:30:00.000Z');

export type GateWorld = {
  readonly db: Database;
  readonly item: ItemState;
  readonly ian: Principal;
  readonly kim: Principal;
  readonly kimEmail: string;
  readonly ianEmail: string;
  readonly viewerEmail: string;
  readonly strangerEmail: string;
};

function repo() {
  const found = repoFromRest(restPull.base.repo);
  if (found === null) throw new TypeError('the fixture repository is malformed');
  return found;
}

export async function greenChecks(db: Database): Promise<void> {
  const runs = ciJobSchema.options.map((name, index) => ({
    id: 9100000401 + index,
    head_sha: head,
    name,
    status: 'completed',
    conclusion: 'success',
    app: { slug: 'github-actions' },
  }));
  const checkRuns = checkRunsFromRest(repo().githubId, runs);
  await upsertFacts(db, { ...emptyBatch, checkRuns }, storedAt);
}

export async function approvedWithFindings(db: Database): Promise<void> {
  const body = reviewBody({
    provider: 'anthropic',
    model: 'claude',
    verdict: 'approve',
    findings: reviewerFindings,
  });
  const approved = {
    ...restReviews[0],
    body,
    state: 'APPROVED',
    submitted_at: '2026-10-02T08:30:00Z',
  };
  const reviews = reviewsFromRest(repo(), restPull.id, [approved]);
  await upsertFacts(db, { ...emptyBatch, reviews }, storedAt);
}

export async function recordedRisk(db: Database, item: ItemState, actor: string): Promise<void> {
  await seedEventRows(db, [
    {
      id: randomUUID(),
      harnessId: item.harnessId,
      itemId: item.itemId,
      name: 'risk_derived',
      actor,
      evidence: {
        paths: ['apps/uw-app/board.tsx'],
        declaration: { riskTier: 'standard', riskDomains: [] },
        floorDomains: [],
        riskTier: 'standard',
        riskDomains: [],
        refusal: null,
        head,
      },
      traceId: randomUUID(),
      at: storedAt,
    },
  ]);
}

async function person(db: Database, name: string, role: 'viewer', area: string): Promise<string> {
  const id = randomUUID();
  const email = `${name}@unfoldingword.org`;
  await seedPerson(db, { id, email });
  await seedGrant(db, {
    id: randomUUID(),
    personId: id,
    role,
    scopeKind: 'jd_area',
    scopeArea: area,
    grantedAt: new Date('2026-01-01T00:00:00.000Z'),
    expiresAt: null,
  });
  return email;
}

export async function gateWorld(db: Database): Promise<GateWorld> {
  const parked = await parkedAtShip(db);
  return {
    db,
    item: parked.item,
    ian: parked.ian,
    kim: parked.kim,
    kimEmail,
    ianEmail: 'ian.lindsley@unfoldingword.org',
    viewerEmail: await person(db, 'gate-viewer', 'viewer', '80-89'),
    strangerEmail: await person(db, 'gate-stranger', 'viewer', '20-29'),
  };
}
