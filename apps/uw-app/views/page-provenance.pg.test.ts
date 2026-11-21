import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { principalSchema, type Principal } from '@uw/contracts';
import type { Database } from '@uw/db/client';
import { writePageAsAgent } from '../pages/agent-write.ts';
import { person } from '../testing/commands.ts';
import { kernelOn, personOn } from '../testing/kernel.ts';
import { fileKnowledge } from '../testing/knowledge.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { screenProblems } from '../testing/screen-checks.ts';
import { getHtml } from '../testing/views.ts';

type Owner = { readonly id: string; readonly email: string };

function documentOf(text: string): Document {
  return new JSDOM(text).window.document;
}

async function agentOf(db: Database, owner: Owner): Promise<Principal> {
  const human = await personOn(db, owner.id, owner.email, new Date());
  return principalSchema.parse({
    ...human,
    identity: `agent:${owner.id}/laptop`,
    kind: 'agent',
    email: null,
  });
}

async function importedByAnAgent(db: Database, owner: Owner): Promise<string> {
  const pageId = crypto.randomUUID();
  const input = {
    pageId,
    type: 'knowledge' as const,
    jdArea: '00-09',
    slug: 'imported-from-notion',
    title: '01.41 Imported from Notion',
    parentId: null,
    frontmatter: { jd_category: '01', jd_id: '01.41' },
    bodyMd: 'Brought across by an agent.',
    expectedVersion: null,
  };
  const request = {
    traceId: crypto.randomUUID(),
    at: new Date(),
    instructions: kernelOn(db, { now: () => new Date() }).reads,
    writer: null,
  };
  const written = await writePageAsAgent(db, await agentOf(db, owner), input, request);
  expect(written).toMatchObject({ ok: true, page: { status: 'draft' } });
  return pageId;
}

function statusShown(document: Document): string | null {
  return document.querySelector('main [data-page-status]')?.textContent?.trim() ?? null;
}

function historyBy(document: Document): readonly string[] {
  return [...document.querySelectorAll('main tbody tr')].map(
    (row) => row.querySelectorAll('td')[2]?.textContent?.trim() ?? '',
  );
}

async function agentPageShowsDraftAndOwner(db: Database): Promise<void> {
  const owner = await person(db, 'import-owner', 'editor', '00-09');
  const pageId = await importedByAnAgent(db, owner);
  const read = await getHtml(db, owner.email, `/pages/${pageId}`);
  expect(read.status).toBe(200);
  expect(await screenProblems(read.text)).toEqual([]);
  const document = documentOf(read.text);
  expect(statusShown(document)).toBe('Draft');
  expect(historyBy(document)).toEqual([`${owner.email}'s agent`]);
  const version = await getHtml(db, owner.email, `/pages/${pageId}/versions/1`);
  expect(version.status).toBe(200);
  expect(documentOf(version.text).querySelector('main')?.textContent).toContain(
    `by ${owner.email}'s agent`,
  );
}

async function livePageShowsNoStatus(db: Database): Promise<void> {
  const editor = await person(db, 'live-editor', 'editor', '00-09');
  const filed = await fileKnowledge(db, editor.email, '01', { title: '01.47 Security' });
  expect(filed.sent.body).toMatchObject({ status: 'accepted' });
  const document = documentOf((await getHtml(db, editor.email, `/pages/${filed.pageId}`)).text);
  expect(statusShown(document)).toBeNull();
  expect(historyBy(document)).toEqual([editor.email]);
}

describe.skipIf(!testServer)('#176 a page says whether it is live and who wrote it', () => {
  it("shows an agent's page as a draft, written by its person's agent", () =>
    withAppDatabase(agentPageShowsDraftAndOwner));

  it('shows no status on a live page, and names a person by their name', () =>
    withAppDatabase(livePageShowsNoStatus));
});
