import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { pageReadReplySchema } from '@uw/contracts';
import type { Database } from '@uw/db/client';
import { get, person, post, type Sent } from '../testing/commands.ts';
import { fileKnowledge, knowledgeBody } from '../testing/knowledge.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';

type World = {
  readonly editor: string;
  readonly reader: string;
  readonly finance: string;
  readonly securityId: string;
  readonly budgetId: string;
};

async function world(db: Database): Promise<World> {
  const editor = await person(db, 'link-editor', 'editor', '00-09');
  const reader = await person(db, 'link-reader', 'viewer', '00-09');
  const finance = await person(db, 'link-finance', 'editor', '20-29');
  const security = await fileKnowledge(db, editor.email, '01', {
    title: '01.47 Security Guidelines',
    bodyMd: '## Passwords\n\nUse sixteen characters.\n\n## Travel\n\nAsk first.',
    frontmatter: { jd_category: '01', jd_id: '01.47', aliases: ['Security'] },
  });
  const budget = await fileKnowledge(db, finance.email, '21', {
    title: '21.10 Rolling Budget',
    bodyMd: 'Row 30 is income.',
  });
  expect(budget.sent.body).toMatchObject({ status: 'accepted' });
  return {
    editor: editor.email,
    reader: reader.email,
    finance: finance.email,
    securityId: security.pageId,
    budgetId: budget.pageId,
  };
}

async function bodyOf(db: Database, email: string, pageId: string): Promise<string> {
  const read = await get(db, { email }, `/api/pages/${pageId}`);
  return pageReadReplySchema.parse(read.body).page.bodyMd;
}

async function htmlOf(db: Database, email: string, pageId: string): Promise<string> {
  const read = await get(db, { email }, `/api/pages/${pageId}?format=html`);
  return pageReadReplySchema.parse(read.body).html ?? '';
}

function save(
  db: Database,
  email: string,
  pageId: string,
  version: number,
  more: object,
): Promise<Sent> {
  return post(db, email, '/api/pages/commands/update_page', {
    ...knowledgeBody('01'),
    command: 'update_page',
    requestId: randomUUID(),
    pageId,
    expectedVersion: version,
    ...more,
  });
}

async function typedLinksAreStoredById(db: Database): Promise<void> {
  const made = await world(db);
  const typed =
    'See [[01.47 Security Guidelines]], [[01.47]], [[security|the rules]] and `[[01.47]]`.';
  const page = await fileKnowledge(db, made.editor, '01', { title: 'Onboarding', bodyMd: typed });
  const link = `(/pages/${made.securityId})`;
  expect(await bodyOf(db, made.editor, page.pageId)).toBe(
    `See [01.47 Security Guidelines]${link}, [01.47 Security Guidelines]${link}, [the rules]${link} and \`[[01.47]]\`.`,
  );
  const saved = await save(db, made.editor, page.pageId, 1, {
    title: 'Onboarding',
    bodyMd: 'Now [[Security Guidelines]].',
  });
  expect(saved.body).toMatchObject({ status: 'accepted' });
  expect(await bodyOf(db, made.editor, page.pageId)).toBe(
    `Now [01.47 Security Guidelines]${link}.`,
  );
}

async function renameBreaksNothing(db: Database): Promise<void> {
  const made = await world(db);
  const page = await fileKnowledge(db, made.editor, '01', {
    title: 'Onboarding',
    bodyMd: 'Read [[01.47]] and [[01.47|the rules]].',
  });
  const renamed = await save(db, made.editor, made.securityId, 1, {
    title: '01.47 Staying Safe',
    bodyMd: 'New text.',
    frontmatter: { jd_category: '01', jd_id: '01.47' },
  });
  expect(renamed.body).toMatchObject({ status: 'accepted' });
  const html = await htmlOf(db, made.reader, page.pageId);
  expect(html).toContain(`<a href="/pages/${made.securityId}">01.47 Staying Safe</a>`);
  expect(html).toContain(`<a href="/pages/${made.securityId}">the rules</a>`);
}

async function linksToPagesThatDoNotExistYet(db: Database): Promise<void> {
  const made = await world(db);
  const page = await fileKnowledge(db, made.editor, '01', {
    title: 'Onboarding',
    bodyMd: 'Then read [[Travel Policy]].',
  });
  expect(await bodyOf(db, made.editor, page.pageId)).toBe('Then read [[Travel Policy]].');
  const before = await htmlOf(db, made.reader, page.pageId);
  expect(before).toContain('data-wiki-missing');
  expect(before).toContain('Travel Policy');
  const target = await fileKnowledge(db, made.editor, '01', { title: 'Travel policy' });
  const after = await htmlOf(db, made.reader, page.pageId);
  expect(after).toContain(`<a href="/pages/${target.pageId}">Travel policy</a>`);
  expect(after).not.toContain('data-wiki-missing');
}

async function ambiguousAndOutOfReach(db: Database): Promise<void> {
  const made = await world(db);
  await fileKnowledge(db, made.editor, '01', { title: 'Templates' });
  await fileKnowledge(db, made.editor, '02', { title: 'Templates' });
  const page = await fileKnowledge(db, made.editor, '03', {
    title: 'Index',
    bodyMd: 'Either [[Templates]] or [[21.10 Rolling Budget]].',
  });
  expect(await bodyOf(db, made.editor, page.pageId)).toBe(
    'Either [[Templates]] or [[21.10 Rolling Budget]].',
  );
  const html = await htmlOf(db, made.reader, page.pageId);
  expect(html).not.toContain(made.budgetId);
}

async function backlinksAreListed(db: Database): Promise<void> {
  const made = await world(db);
  const first = await fileKnowledge(db, made.editor, '01', {
    title: 'Onboarding',
    bodyMd: 'Read [[01.47]].',
  });
  await fileKnowledge(db, made.editor, '01', { title: 'Unrelated', bodyMd: 'Nothing.' });
  const linked = await get(db, { email: made.reader }, `/api/pages/${made.securityId}/backlinks`);
  expect(linked.body).toMatchObject({ pages: [{ id: first.pageId, title: 'Onboarding' }] });
  await save(db, made.editor, first.pageId, 1, { title: 'Onboarding', bodyMd: 'No link now.' });
  const gone = await get(db, { email: made.reader }, `/api/pages/${made.securityId}/backlinks`);
  expect(gone.body).toMatchObject({ pages: [] });
  const hidden = await get(db, { email: made.finance }, `/api/pages/${made.securityId}/backlinks`);
  expect(hidden.body).toMatchObject({ status: 'error', reason: 'page_not_found' });
}

describe.skipIf(!testServer)('#175 a wiki link typed anywhere becomes a link by page id', () => {
  it('rewrites [[title]], [[JD ID]] and [[alias|words]] on create and save, and leaves code alone', () =>
    withAppDatabase(typedLinksAreStoredById));

  it('follows the page it points at through a rename, keeping words the author chose', () =>
    withAppDatabase(renameBreaksNothing));

  it('keeps a link to a page that does not exist yet, and resolves it once the page exists', () =>
    withAppDatabase(linksToPagesThatDoNotExistYet));

  it('leaves a title that matches two pages, or a page the author cannot read, as typed', () =>
    withAppDatabase(ambiguousAndOutOfReach));

  it('lists the pages that link to a page, and drops one when its link is removed', () =>
    withAppDatabase(backlinksAreListed));
});
