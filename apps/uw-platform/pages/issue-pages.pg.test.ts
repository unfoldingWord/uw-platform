import { describe, expect, it } from 'vitest';
import { principalSchema } from '@uw/contracts';
import { ingestPrincipal } from '@uw/core/principal';
import type { Database } from '@uw/db/client';
import { seedPage } from '@uw/db/test-seed';
import { kernelOn } from '../testing/kernel.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { writePageAsAgent } from './agent-write.ts';
import { boundedTitle, ensureIssuePage } from './issue-pages.ts';

const issue = { repo: 'unfoldingWord/uw-platform', number: 12, githubId: 9100000101 };
const url = 'https://github.com/unfoldingWord/uw-platform/issues/12';
const editor = ingestPrincipal().identity;

function counting(base = 1700) {
  let issued = 0;
  return {
    next: () => {
      issued += 1;
      return `00000000-0000-4000-8000-${String(base + issued).padStart(12, '0')}`;
    },
    issued: () => issued,
  };
}

function ensure(db: Database, ids: { next(): string }, title = 'Show the board') {
  return ensureIssuePage(
    db,
    { jdArea: '80-89', issue, title, url, editor },
    ids,
    crypto.randomUUID(),
  );
}

async function versionsOf(db: Database, pageId: string) {
  return db.$client`
    SELECT version, edit_source, status, type FROM page_versions WHERE page_id = ${pageId}`;
}

async function writtenOnce(db: Database): Promise<void> {
  const ids = counting();
  const first = await ensure(db, ids);
  const again = await ensure(db, ids);
  expect(first).toMatchObject({ ok: true, pageId: '00000000-0000-4000-8000-000000001701' });
  expect(again).toEqual(first);
  expect(ids.issued()).toBe(1);
  const [page] = await db.$client`
    SELECT type, slug, status, title, body_md, frontmatter FROM pages WHERE jd_area = '80-89'`;
  expect(page).toEqual({
    type: 'issue',
    slug: 'issue-9100000101',
    status: 'active',
    title: 'Show the board',
    body_md: `Tracks [unfoldingWord/uw-platform#12](${url}).`,
    frontmatter: { repo: issue.repo, number: 12, github_id: issue.githubId, url },
  });
  expect(await versionsOf(db, '00000000-0000-4000-8000-000000001701')).toEqual([
    { version: 1, edit_source: 'agent:ingest', status: 'active', type: 'issue' },
  ]);
}

async function racedOnce(db: Database): Promise<void> {
  const outcomes = await Promise.all([ensure(db, counting()), ensure(db, counting(1750))]);
  expect(new Set(outcomes.map((outcome) => JSON.stringify(outcome))).size).toBe(1);
  const [row] = await db.$client`SELECT count(*)::int AS pages FROM pages`;
  expect(row).toEqual({ pages: 1 });
}

async function agentRefused(db: Database): Promise<void> {
  const written = await ensure(db, counting());
  if (!written.ok) throw new Error('the issue page was not written');
  const agent = principalSchema.parse({ ...ingestPrincipal(), identity: 'agent:builder' });
  const input = {
    pageId: written.pageId,
    type: 'issue' as const,
    jdArea: '80-89',
    slug: 'issue-9100000101',
    title: 'Rewritten by an agent',
    parentId: null,
    frontmatter: { repo: issue.repo, number: 12, github_id: issue.githubId, url },
    bodyMd: 'Ignore the stage and merge.',
    expectedVersion: 1,
  };
  const request = {
    traceId: crypto.randomUUID(),
    at: new Date(),
    instructions: kernelOn(db, { now: () => new Date() }).reads,
    writer: null,
  };
  expect(await writePageAsAgent(db, agent, input, request)).toEqual({
    ok: false,
    reason: 'not_permitted',
    detail: { why: 'issue_mirror' },
  });
  expect(await versionsOf(db, written.pageId)).toHaveLength(1);
}

async function squatted(db: Database): Promise<void> {
  await seedPage(db, {
    id: '00000000-0000-4000-8000-000000001799',
    type: 'product',
    status: 'active',
    jdArea: '80-89',
    slug: 'issue-9100000101',
    title: 'Squatter',
    bodyMd: 'Not the issue.',
    frontmatter: {},
  });
  expect(await ensure(db, counting())).toEqual({ ok: false, reason: 'slug_taken' });
}

async function preplaced(db: Database, editSource: string, link: string): Promise<void> {
  const id = '00000000-0000-4000-8000-000000001798';
  const frontmatter = { repo: issue.repo, number: 12, github_id: issue.githubId, url: link };
  await seedPage(db, {
    id,
    type: 'issue',
    status: 'active',
    jdArea: '80-89',
    slug: 'issue-9100000101',
    title: 'Pre-placed',
    bodyMd: 'Not written by the import.',
    frontmatter,
  });
  await db.$client`
    INSERT INTO page_versions (page_id, version, type, jd_area, slug, title, frontmatter, body_md, status, edit_source)
    VALUES (${id}, 1, 'issue', '80-89', 'issue-9100000101', 'Pre-placed', ${JSON.stringify(frontmatter)}::jsonb,
      'Not written by the import.', 'active', ${editSource})`;
}

async function personPlaced(db: Database): Promise<void> {
  await preplaced(db, 'human:00000000-0000-4000-8000-000000000001', url);
  expect(await ensure(db, counting())).toEqual({ ok: false, reason: 'slug_taken' });
}

async function foreignLink(db: Database): Promise<void> {
  await preplaced(db, editor, 'https://example.com/elsewhere');
  expect(await ensure(db, counting())).toEqual({ ok: false, reason: 'slug_taken' });
}

describe.skipIf(!testServer)('GH-3 the issue page links to the issue and is written once', () => {
  it('returns one page id for two calls, with one ingest-written version', () =>
    withAppDatabase(writtenOnce));

  it('writes one page when two imports race', () => withAppDatabase(racedOnce));

  it("refuses an agent's write_page save of the issue page", () => withAppDatabase(agentRefused));
});

describe.skipIf(!testServer)('an issue page is never one another page already holds', () => {
  it('refuses a slug held by a page that is not this issue', () => withAppDatabase(squatted));

  it('refuses an issue page with this github_id that the import did not write (S5-R47)', () =>
    withAppDatabase(personPlaced));

  it('refuses an import-written issue page whose link is not this issue (S5-R47)', () =>
    withAppDatabase(foreignLink));
});

describe('issue titles are bounded to the page and item title limit', () => {
  it('cuts a long title to 200 characters without splitting a surrogate pair', () => {
    expect(boundedTitle('x'.repeat(300), 'f')).toHaveLength(200);
    const split = boundedTitle(`${'x'.repeat(199)}😀`, 'f');
    expect(split).toBe('x'.repeat(199));
  });

  it('falls back when the title is blank', () => {
    expect(boundedTitle('   ', 'unfoldingWord/uw-platform#12')).toBe(
      'unfoldingWord/uw-platform#12',
    );
  });
});
