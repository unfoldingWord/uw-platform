import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { pageReadReplySchema } from '@uw/contracts';
import type { Database } from '@uw/db/client';
import { get, person, post } from '../testing/commands.ts';
import { fileKnowledge, knowledgeBody } from '../testing/knowledge.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';

type World = {
  readonly editor: string;
  readonly reader: string;
  readonly both: string;
  readonly sourceId: string;
  readonly privateId: string;
};

async function world(db: Database): Promise<World> {
  const editor = await person(db, 'embed-editor', 'editor', '00-09');
  const reader = await person(db, 'embed-reader', 'viewer', '00-09');
  const both = await person(db, 'embed-both', 'editor', '20-29');
  await post(db, 'rowan.test@unfoldingword.org', '/api/acl/commands/grant_role', {
    command: 'grant_role',
    requestId: randomUUID(),
    personId: both.id,
    role: 'editor',
    scopeKind: 'jd_area',
    scopeArea: '00-09',
    expiresAt: null,
  });
  const source = await fileKnowledge(db, editor.email, '01', {
    title: 'Area Descriptions',
    bodyMd: 'Intro line.\n\n## Finance\n\nBudgets and audits.\n\n## Field\n\nPrograms abroad.',
  });
  const secret = await fileKnowledge(db, both.email, '21', {
    title: '21.40 Salary Bands',
    bodyMd: 'Band A is confidential.',
  });
  expect(secret.sent.body).toMatchObject({ status: 'accepted' });
  return {
    editor: editor.email,
    reader: reader.email,
    both: both.email,
    sourceId: source.pageId,
    privateId: secret.pageId,
  };
}

async function read(db: Database, email: string, pageId: string) {
  const sent = await get(db, { email }, `/api/pages/${pageId}?format=html`);
  return pageReadReplySchema.parse(sent.body);
}

function save(db: Database, email: string, pageId: string, version: number, bodyMd: string) {
  return post(db, email, '/api/pages/commands/update_page', {
    ...knowledgeBody('01'),
    command: 'update_page',
    requestId: randomUUID(),
    pageId,
    expectedVersion: version,
    bodyMd,
  });
}

async function embedsShowTheSource(db: Database): Promise<void> {
  const made = await world(db);
  const page = await fileKnowledge(db, made.editor, '01', {
    title: 'Training Guide',
    bodyMd:
      'Each area:\n\n![[Area Descriptions#Finance]]\n\nAnd everything:\n\n![[Area Descriptions]]',
  });
  const shown = await read(db, made.reader, page.pageId);
  expect(shown.page.bodyMd).toContain(`![Area Descriptions](/pages/${made.sourceId}#finance)`);
  expect(shown.page.bodyMd).toContain(`![Area Descriptions](/pages/${made.sourceId})`);
  const html = shown.html ?? '';
  expect(html.match(/data-embed=/g)).toHaveLength(2);
  expect(html.match(/Budgets and audits\./g)).toHaveLength(2);
  expect(html.match(/Programs abroad\./g)).toHaveLength(1);
  expect(html).toContain(`href="/pages/${made.sourceId}"`);
  await save(db, made.editor, made.sourceId, 1, '## Finance\n\nBudgets, audits and contracts.');
  const after = (await read(db, made.reader, page.pageId)).html ?? '';
  expect(after.match(/Budgets, audits and contracts\./g)).toHaveLength(2);
  expect(after).not.toContain('Programs abroad.');
}

async function accessIsTheReaders(db: Database): Promise<void> {
  const made = await world(db);
  const page = await fileKnowledge(db, made.both, '01', {
    title: 'Pay overview',
    bodyMd: 'Bands:\n\n![[21.40 Salary Bands]]',
  });
  expect(page.sent.body).toMatchObject({ status: 'accepted' });
  const author = (await read(db, made.both, page.pageId)).html ?? '';
  expect(author).toContain('Band A is confidential.');
  const reader = (await read(db, made.reader, page.pageId)).html ?? '';
  expect(reader).not.toContain('Band A');
  expect(reader).not.toContain('Salary Bands');
  expect(reader).toContain('You do not have access to this section.');
}

async function missingSectionsSaySo(db: Database): Promise<void> {
  const made = await world(db);
  const page = await fileKnowledge(db, made.editor, '01', {
    title: 'Training Guide',
    bodyMd: '![[Area Descriptions#Field]]',
  });
  await save(db, made.editor, made.sourceId, 1, '## Finance\n\nOnly this now.');
  const html = (await read(db, made.reader, page.pageId)).html ?? '';
  expect(html).toContain('This section no longer exists.');
  expect(html).not.toContain('Only this now.');
}

async function cyclesAreRefused(db: Database): Promise<void> {
  const made = await world(db);
  const self = await save(db, made.editor, made.sourceId, 1, '![[Area Descriptions]]');
  expect(self.body).toMatchObject({ status: 'error', reason: 'embed_cycle' });
  const outer = await fileKnowledge(db, made.editor, '01', {
    title: 'Outer',
    bodyMd: '![[Area Descriptions]]',
  });
  const loop = await save(db, made.editor, made.sourceId, 1, 'Now ![[Outer]].');
  expect(loop.body).toMatchObject({ status: 'error', reason: 'embed_cycle' });
  await fileKnowledge(db, made.editor, '01', { title: 'Far', bodyMd: '![[Outer]]' });
  const top = await fileKnowledge(db, made.editor, '01', { title: 'Top', bodyMd: '![[Far]]' });
  const html = (await read(db, made.reader, top.pageId)).html ?? '';
  expect(html).toContain(`href="/pages/${outer.pageId}"`);
  expect(html).not.toContain('Budgets and audits.');
}

describe.skipIf(!testServer)('#175 one text can be shown on several pages', () => {
  it('shows a whole page or one section in place, and follows the source when it changes', () =>
    withAppDatabase(embedsShowTheSource));

  it('checks access for the reader, and tells a reader without it nothing about the source', () =>
    withAppDatabase(accessIsTheReaders));

  it('says so when the embedded section has been removed', () =>
    withAppDatabase(missingSectionsSaySo));

  it('refuses a page that would embed itself, and stops nesting at two levels', () =>
    withAppDatabase(cyclesAreRefused));
});
