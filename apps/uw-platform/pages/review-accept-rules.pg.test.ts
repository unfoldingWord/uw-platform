import { describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import type { Principal } from '@uw/contracts';
import { seedPage } from '@uw/db/test-seed';
import { activationFor } from '../measures/activations.ts';
import { saveMeasure } from '../measures/authoring.ts';
import { collectionsAt } from '../testing/collections.ts';
import {
  agentOf,
  forceActive,
  geoMeasure,
  MEASURE_AREA,
  measureWorld,
  newId,
} from '../testing/measure-world.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { anchorOf } from './anchors.ts';
import { acceptReviewSet } from './review-decisions.ts';
import { proposeReviewSet } from './review-sets.ts';
import { readPage } from './store.ts';

const ON = collectionsAt;
const BODY = 'Counts every website we keep.';

async function heldOn(db: Database, person: Principal, pageId: string): Promise<string> {
  const page = await readPage(db, person, pageId, ON);
  if (page === null) throw new Error('the page is not readable');
  const at = page.bodyMd.indexOf('every');
  const held = await proposeReviewSet(
    db,
    person,
    {
      command: 'propose_review_set',
      requestId: newId(),
      pageId,
      baseVersion: page.version,
      name: 'Plainer words',
      changes: [
        {
          kind: 'replacement',
          anchor: anchorOf(page.bodyMd, at, at + 5),
          text: 'each',
          note: null,
        },
      ],
    },
    newId(),
    ON,
  );
  if (!held.ok || held.reviewSetId === undefined) throw new Error('no review set was held');
  return held.reviewSetId;
}

function accept(db: Database, person: Principal, reviewSetId: string) {
  const command = {
    command: 'accept_review_set' as const,
    requestId: newId(),
    reviewSetId,
    revision: 1,
  };
  return acceptReviewSet(db, person, command, newId(), ON);
}

async function issueMirrorRefused(db: Database): Promise<void> {
  const { admin } = await measureWorld(db);
  const pageId = newId();
  await seedPage(db, {
    id: pageId,
    type: 'issue',
    status: 'active',
    jdArea: MEASURE_AREA,
    slug: 'issue-42',
    title: 'Issue 42',
    bodyMd: BODY,
    frontmatter: {
      repo: 'example-org/example-repo',
      number: 42,
      github_id: 9100000042,
      url: 'https://github.example.org/example-org/example-repo/issues/42',
    },
  });
  const reviewSetId = await heldOn(db, admin, pageId);
  expect(await accept(db, admin, reviewSetId)).toEqual({
    ok: false,
    reason: 'not_permitted',
    detail: { why: 'issue_mirror' },
  });
  expect(await readPage(db, admin, pageId, ON)).toMatchObject({ version: 1, bodyMd: BODY });
}

async function activeDashboardBackToSuggested(db: Database): Promise<void> {
  const { admin } = await measureWorld(db);
  const pageId = newId();
  await seedPage(db, {
    id: pageId,
    type: 'dashboard',
    status: 'active',
    jdArea: MEASURE_AREA,
    slug: 'website-counts',
    title: 'Website counts',
    bodyMd: BODY,
    frontmatter: { context: { kind: 'host', descendants: false } },
  });
  const reviewSetId = await heldOn(db, admin, pageId);
  expect(await accept(db, admin, reviewSetId)).toMatchObject({
    ok: true,
    page: { version: 2, status: 'suggested', bodyMd: 'Counts each website we keep.' },
  });
}

async function activeMeasurePausedOnAccept(db: Database): Promise<void> {
  const world = await measureWorld(db);
  const measureId = newId();
  const made = await saveMeasure(
    { db, actor: agentOf(world.admin), traceId: newId(), at: ON },
    {
      measureId,
      expectedVersion: null,
      jdArea: MEASURE_AREA,
      title: 'Websites kept',
      slug: `websites-kept-${measureId.slice(0, 8)}`,
      bodyMd: BODY,
      measure: geoMeasure(),
    },
  );
  if (!made.ok) throw new Error(made.reason);
  const active = await forceActive(world, measureId);
  const reviewSetId = await heldOn(db, world.admin, measureId);
  expect(await accept(db, world.admin, reviewSetId)).toMatchObject({
    ok: true,
    page: { version: active + 1, status: 'suggested' },
  });
  expect((await activationFor(db, measureId))?.pausedReason).toBe('changed');
}

describe.skipIf(!testServer)(
  '#197 accepting a review set follows the rules of an ordinary page edit',
  () => {
    it('refuses to accept changes into an issue mirror and leaves it unchanged', () =>
      withAppDatabase(issueMirrorRefused));

    it('returns an edited active dashboard to suggested', () =>
      withAppDatabase(activeDashboardBackToSuggested));

    it('returns an edited active measure to suggested and pauses its activation', () =>
      withAppDatabase(activeMeasurePausedOnAccept));
  },
);
