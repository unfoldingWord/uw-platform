import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.tsx';
import { createAccessFixture } from '../testing/access-keys.ts';
import { get, person } from '../testing/commands.ts';
import { fileKnowledge } from '../testing/knowledge.ts';
import { callTool, httpClient } from '../testing/mcp.ts';
import { postgresDeps, testServer, withAppDatabase } from '../testing/postgres.ts';
import type { Database } from '@uw/db/client';

async function agentWritesAWikiLink(db: Database): Promise<void> {
  const editor = await person(db, 'verb-editor', 'editor', '80-89');
  const target = await fileKnowledge(db, editor.email, '81', {
    title: '81.26 Budgeting',
    frontmatter: { jd_category: '81', jd_id: '81.26' },
  });
  const fixture = await createAccessFixture();
  const token = await fixture.signForMcp({ email: editor.email });
  const client = await httpClient(createApp(postgresDeps(db, fixture)), {
    'cf-access-jwt-assertion': token,
    'x-uw-device': 'laptop',
  });
  const pageId = randomUUID();
  const written = await callTool(client, 'write_page', {
    pageId,
    type: 'knowledge',
    jdArea: '80-89',
    slug: 'agent-notes',
    title: 'Agent notes',
    parentId: null,
    frontmatter: { jd_category: '81' },
    bodyMd: 'The rates are in [[81.26]] and in [[Budgeting|the budget page]].',
    expectedVersion: null,
  });
  expect(written.body).toMatchObject({ pageId, version: 1 });
  const read = await get(db, { email: editor.email }, `/api/pages/${pageId}`);
  const link = `(/pages/${target.pageId})`;
  expect(read.body['page']).toMatchObject({
    bodyMd: `The rates are in [81.26 Budgeting]${link} and in [the budget page]${link}.`,
  });
  const backlinks = await get(db, { email: editor.email }, `/api/pages/${target.pageId}/backlinks`);
  expect(backlinks.body).toMatchObject({ pages: [{ id: pageId }] });
}

describe.skipIf(!testServer)('#175 a wiki link written by an agent', () => {
  it('is stored as a link by page id through write_page, the same as one a person typed', () =>
    withAppDatabase(agentWritesAWikiLink));
});
