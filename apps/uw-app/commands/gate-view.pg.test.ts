import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { gateViewSchema, type HarnessEvent, defaultCiChecks } from '@uw/contracts';
import type { Database } from '@uw/db/client';
import { seedGrant, seedPerson } from '@uw/db/test-seed';
import { reviewBody, software } from '@uw/harness';
import restPull from '../github/fixtures/rest-pull.json' with { type: 'json' };
import restReviews from '../github/fixtures/rest-reviews.json' with { type: 'json' };
import { repoFromRest, reviewsFromRest } from '../github/facts/normalise.ts';
import { emptyBatch } from '../github/facts/records.ts';
import { upsertFacts } from '../github/facts/upsert.ts';
import { fixtureApp } from '../github/testing/app-key.ts';
import { head } from '../github/testing/facts-fixtures.ts';
import { kimEmail, parkedAtShip, type ParkedAtShip } from '../github/testing/gate-rig.ts';
import { attemptShip } from '../github/testing/ship-rig.ts';
import { accepted, allEvents, callerOf, get, type Sent } from '../testing/commands.ts';
import { agentForms, readAs } from '../testing/harness-reads.ts';
import { kernelOn } from '../testing/kernel.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';

const missingItem = '00000000-0000-4000-8000-0000000000ef';
const strangerEmail = 'stranger@unfoldingword.org';

const edgeIdentities = ['agent:system', 'agent:ingest'];

function gatePath(harnessId: string, itemId: string): string {
  return `/api/harness/${harnessId}/gates/${itemId}`;
}

function viewAs(db: Database, email: string, path: string): Promise<Sent> {
  return get(db, { email }, path);
}

function lastRiskDerived(events: readonly HarnessEvent[], itemId: string) {
  const found = events.findLast(
    (event) => event.name === 'risk_derived' && event.itemId === itemId,
  );
  if (found === undefined) throw new Error('no risk_derived event');
  return found.evidence;
}

function sameAsMissing(hidden: Sent, missing: Sent): void {
  expect(hidden.status).toBe(404);
  expect(hidden.body).toEqual({ status: 'error', reason: 'item_not_found' });
  expect(hidden.text).toBe(missing.text);
}

async function otherHarness(db: Database, parked: ParkedAtShip): Promise<string> {
  const harnessId = randomUUID();
  const kernel = kernelOn(db, { now: () => new Date() });
  accepted(
    await kernel.stages.activate(callerOf(parked.ian), {
      harnessId,
      harnessKey: 'software-two',
      jdArea: '80-89',
      template: software,
      repository: 'unfoldingWord/uw-other',
      requiredChecks: [...defaultCiChecks],
    }),
  );
  return harnessId;
}

async function stranger(db: Database): Promise<void> {
  const personId = randomUUID();
  await seedPerson(db, { id: personId, email: strangerEmail });
  await seedGrant(db, {
    id: randomUUID(),
    personId,
    role: 'viewer',
    scopeKind: 'jd_area',
    scopeArea: '20-29',
    grantedAt: new Date(Date.now() - 60_000),
    expiresAt: null,
  });
}

async function viewShown(db: Database): Promise<void> {
  const shipped = await attemptShip(db, await fixtureApp());
  const { itemId, harnessId } = shipped.item;
  const sent = await viewAs(db, kimEmail, gatePath(harnessId, itemId));
  expect(sent.status).toBe(200);
  const view = gateViewSchema.parse(sent.body);
  expect(view).toEqual(sent.body);
  expect(view).toMatchObject({ itemId, harnessId, stageKey: 'ship', gateStatus: 'parked' });
  expect(view.facts?.declaration).toEqual({
    closes: [],
    risks: 'the board renders slower on phones',
    touches: 'apps/uw-app/board',
    riskTier: 'standard',
    riskDomains: [],
  });
  const recorded = lastRiskDerived(await allEvents(db, harnessId), itemId);
  expect(view.recorded).toEqual({
    riskTier: recorded['riskTier'],
    riskDomains: recorded['riskDomains'],
    floorDomains: recorded['floorDomains'],
    head: recorded['head'],
    declaration: recorded['declaration'],
    refusal: recorded['refusal'],
  });
  expect(view.recorded?.head).toBe(shipped.item.expectedHead);
  expect(view.recorded?.head).toBe(head);
  expect(sent.text).not.toContain(restPull.body);
  expect(sent.text).not.toContain('Adds the board.');
}

async function hiddenItem(db: Database): Promise<void> {
  const parked = await parkedAtShip(db);
  await stranger(db);
  const { itemId, harnessId } = parked.item;
  const other = await otherHarness(db, parked);
  const missing = await viewAs(db, kimEmail, gatePath(harnessId, missingItem));
  expect(missing.status).toBe(404);
  expect(missing.body).toEqual({ status: 'error', reason: 'item_not_found' });
  sameAsMissing(await viewAs(db, strangerEmail, gatePath(harnessId, itemId)), missing);
  sameAsMissing(await viewAs(db, kimEmail, gatePath(other, itemId)), missing);
  sameAsMissing(await viewAs(db, kimEmail, gatePath(randomUUID(), itemId)), missing);
  sameAsMissing(await viewAs(db, kimEmail, gatePath(harnessId, 'not-a-uuid')), missing);
  sameAsMissing(await viewAs(db, kimEmail, gatePath('not-a-uuid', itemId)), missing);
  const token = { common_name: 'svc-reader' };
  const service = await get(db, token, gatePath(harnessId, itemId));
  const serviceMissing = await get(db, token, gatePath(harnessId, missingItem));
  expect(service.body).toEqual({ status: 'error', reason: 'unauthenticated' });
  expect(service.text).toBe(serviceMissing.text);
}

async function agentsDecideNoGate(db: Database): Promise<void> {
  const parked = await parkedAtShip(db);
  const { itemId, harnessId } = parked.item;
  const forms = await agentForms(db, parked.ian, harnessId, edgeIdentities);
  for (const agent of forms.readable) {
    const sent = await readAs(db, agent, gatePath(harnessId, itemId));
    expect(sent.status).toBe(403);
    expect(sent.body).toEqual({ status: 'error', reason: 'not_permitted' });
  }
  for (const agent of forms.hidden) {
    const missing = await readAs(db, agent, gatePath(harnessId, missingItem));
    sameAsMissing(await readAs(db, agent, gatePath(harnessId, itemId)), missing);
  }
}

const storedDeclaration = {
  closes: ['#12'],
  risks: 'the board renders slower on phones',
  touches: 'apps/uw-app/board',
  riskTier: 'standard',
  riskDomains: [],
};

async function storeCloses(db: Database, closes: readonly string[]): Promise<void> {
  const declaration = JSON.stringify({ ...storedDeclaration, closes });
  await db.$client`UPDATE gh_prs SET declaration = ${declaration}::jsonb WHERE number = 7`;
}

async function overLongReference(db: Database): Promise<void> {
  const parked = await parkedAtShip(db);
  const path = gatePath(parked.item.harnessId, parked.item.itemId);
  const atLimit = `${'o'.repeat(156)}/r#1`;
  await storeCloses(db, ['#12', atLimit]);
  const shown = await viewAs(db, kimEmail, path);
  expect(shown.status).toBe(200);
  expect(gateViewSchema.parse(shown.body).facts?.declaration?.closes).toEqual(['#12', atLimit]);
  const over = `${'o'.repeat(157)}/r#1`;
  await storeCloses(db, ['#12', over]);
  const hidden = await viewAs(db, kimEmail, path);
  expect(hidden.status).toBe(200);
  const view = gateViewSchema.parse(hidden.body);
  expect(view.facts).not.toBeNull();
  expect(view.facts?.declaration).toBeNull();
  expect(hidden.text).not.toContain(over);
}

const reviewerFindings = ['The lease is not renewed', 'A typo in the copy'];

async function storedFindings(db: Database): Promise<void> {
  const parked = await parkedAtShip(db);
  const repo = repoFromRest(restPull.base.repo);
  if (repo === null) throw new TypeError('the fixture repository is malformed');
  const body = reviewBody({
    provider: 'anthropic',
    model: 'claude',
    verdict: 'request_changes',
    findings: reviewerFindings,
  });
  const reviews = reviewsFromRest(repo, restPull.id, [
    { ...restReviews[0], body, state: 'CHANGES_REQUESTED', submitted_at: '2026-10-02T08:30:00Z' },
  ]);
  await upsertFacts(db, { ...emptyBatch, reviews }, new Date('2026-10-02T08:30:00.000Z'));
  const sent = await viewAs(db, kimEmail, gatePath(parked.item.harnessId, parked.item.itemId));
  expect(sent.status).toBe(200);
  const view = gateViewSchema.parse(sent.body);
  expect(view.reviews).toEqual([
    {
      reviewer: 'uw-reviewer',
      commit: head,
      state: 'changes_requested',
      provider: 'anthropic',
      findings: reviewerFindings.map((text) => ({ text, weight: null })),
    },
  ]);
}

describe.skipIf(!testServer)('WB-6 the gate route answers the Reviewer findings', () => {
  it('WB-6 the gate route answers the Reviewer findings stored from the review body', () =>
    withAppDatabase(storedFindings));
});

describe.skipIf(!testServer)('GH-5 the gate view route', () => {
  it('GH-5 the gate view route shows the parsed declaration, the tier and domains and the head they were derived at', () =>
    withAppDatabase(viewShown));

  it('GH-5 the gate view route of a hidden item is item_not_found', () =>
    withAppDatabase(hiddenItem));

  it('GH-5 the gate view route shows no declaration when a stored closed issue reference is over the limit, and does not fail', () =>
    withAppDatabase(overLongReference));
});

describe.skipIf(!testServer)('the gate view route shows an agent no gate', () => {
  it('refuses an agent that may read the item, and answers one that may not as a missing item', () =>
    withAppDatabase(agentsDecideNoGate));
});
