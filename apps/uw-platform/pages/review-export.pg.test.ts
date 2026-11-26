import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { Principal, SuggestedChangeInput } from '@uw/contracts';
import { formatDate } from '@uw/core/dates';
import type { Database } from '@uw/db/client';
import { pageVersions } from '@uw/db/schema';
import { seedGrant, seedPage, seedPerson } from '@uw/db/test-seed';
import { clock } from '../github/testing/ship-rig.ts';
import { parseMarked } from '../markdown/critic.ts';
import { readExport, verifyExport } from '../markdown/export-verify.ts';
import { pageVersionHash } from '../pdf/provenance.ts';
import { personOn } from '../testing/kernel.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { getHtml } from '../testing/views.ts';
import { anchorOf } from './anchors.ts';
import { proposeReviewSet, reviewSetFor } from './review-sets.ts';
import { updatePage } from './store.ts';

const EDITOR = { id: '00000000-0000-4000-8000-000000003c01', email: 'cy.example@example.org' };
const AREA = '00-09';
const POLICY = '00000000-0000-4000-8000-000000003c11';
const BODY = 'Two adults are present.\n\nRecords are kept for a year.';
const frontmatter = { enforcement: 'required', effective_from: '2026-01-01' };

async function world(db: Database): Promise<Principal> {
  await seedPerson(db, EDITOR);
  await seedGrant(db, {
    id: '00000000-0000-4000-8000-000000003c02',
    personId: EDITOR.id,
    role: 'editor',
    scopeKind: 'jd_area',
    scopeArea: AREA,
    grantedAt: new Date('2026-01-01T00:00:00.000Z'),
    expiresAt: null,
  });
  await seedPage(db, {
    id: POLICY,
    type: 'policy',
    status: 'active',
    jdArea: AREA,
    slug: 'records',
    title: 'Records',
    bodyMd: 'Seeded.',
    frontmatter,
  });
  const person = await personOn(db, EDITOR.id, EDITOR.email, clock.now());
  const saved = await updatePage(
    db,
    person,
    {
      command: 'update_page',
      requestId: crypto.randomUUID(),
      pageId: POLICY,
      expectedVersion: 1,
      slug: 'records',
      title: 'Records',
      parentId: null,
      frontmatter,
      bodyMd: BODY,
      status: 'active',
    },
    crypto.randomUUID(),
    clock.now(),
  );
  expect(saved).toMatchObject({ ok: true, page: { version: 2 } });
  return person;
}

const marks: readonly SuggestedChangeInput[] = [
  { kind: 'replacement', anchor: anchorOf(BODY, 0, 3), text: 'Three', note: 'Ratio rule.' },
  { kind: 'comment', anchor: anchorOf(BODY, 4, 10), text: '', note: 'Who counts?' },
  { kind: 'deletion', anchor: anchorOf(BODY, 41, 52), text: '', note: null },
];

function proposal(changes: readonly SuggestedChangeInput[], name: string) {
  return {
    command: 'propose_review_set' as const,
    requestId: crypto.randomUUID(),
    pageId: POLICY,
    baseVersion: 2,
    name,
    changes: [...changes],
  };
}

async function setChanges(db: Database, person: Principal, reviewSetId: string | undefined) {
  const found = await reviewSetFor(db, person, reviewSetId ?? '', clock.now());
  return found?.changes.map(({ kind, anchor, text, note }) => ({ kind, anchor, text, note }));
}

async function exported(db: Database, mode: string): Promise<string> {
  const page = await getHtml(
    db,
    EDITOR.email,
    `/api/pages/${POLICY}/export?mode=${mode}`,
    {},
    clock,
  );
  expect(page.status).toBe(200);
  return page.text;
}

async function roundTrip(db: Database): Promise<void> {
  const person = await world(db);
  const held = await proposeReviewSet(
    db,
    person,
    proposal(marks, 'Board review'),
    'trace',
    clock.now(),
  );
  if (!held.ok) throw new Error(held.reason);
  const text = await exported(db, 'marked');
  const plain = new TextDecoder().decode(new TextEncoder().encode(text));
  const read = readExport(plain);
  expect(read?.stamp).toMatchObject({ source: 'records@2', mode: 'marked' });
  const parsed = parseMarked(read?.body ?? '');
  expect(parsed.original).toBe(BODY);
  const imported = await proposeReviewSet(
    db,
    person,
    proposal(parsed.changes, 'Board review, read back'),
    'trace',
    clock.now(),
  );
  if (!imported.ok) throw new Error(imported.reason);
  const original = await setChanges(db, person, held.reviewSetId);
  expect(original).toEqual(marks);
  expect(await setChanges(db, person, imported.reviewSetId)).toEqual(original);
}

async function storedVersion(db: Database) {
  const [row] = await db
    .select()
    .from(pageVersions)
    .where(and(eq(pageVersions.pageId, POLICY), eq(pageVersions.version, 2)));
  if (row === undefined) throw new Error('version 2 was not kept');
  return { ...row, pageId: POLICY };
}

async function hashMatches(db: Database): Promise<void> {
  await world(db);
  const snapshot = await storedVersion(db);
  const accepted = await exported(db, 'accepted');
  const acceptedBody = readExport(accepted)?.body ?? '';
  expect(readExport(accepted)?.stamp).toEqual({
    source: 'records@2',
    exported: formatDate(clock.now()),
    sha256: await pageVersionHash(snapshot),
    mode: 'accepted',
  });
  for (const mode of ['accepted', 'original', 'marked']) {
    expect(await verifyExport(await exported(db, mode), { snapshot, acceptedBody })).toEqual({
      ok: true,
    });
  }
  const tampered = accepted.replace('kept for a year', 'kept for a day');
  expect(await verifyExport(tampered, { snapshot, acceptedBody })).toEqual({
    ok: false,
    why: 'text_mismatch',
  });
  const refused = await getHtml(
    db,
    EDITOR.email,
    `/api/pages/${POLICY}/export?mode=redline`,
    {},
    clock,
  );
  expect(refused.status).toBe(400);
}

describe.skipIf(!testServer)(
  '#197 exports carry suggested changes and resolve to the stored version',
  () => {
    it('round-trips a marked export through plain text back to the same suggested changes', () =>
      withAppDatabase(roundTrip));

    it("stamps each mode with the stored version's sha256 and refuses a tampered export", () =>
      withAppDatabase(hashMatches));
  },
);
