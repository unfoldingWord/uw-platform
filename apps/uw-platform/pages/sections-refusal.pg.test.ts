import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import { seedPage } from '@uw/db/test-seed';
import { person, post } from '../testing/commands.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { postForm } from '../testing/views.ts';

const AREA = '00-09';
const WITHOUT_ROADMAP = '## Need\nN.\n## Idea\nI.\n## Strategy\nS.\n## Outcomes\nO.\n## Risks\nR.';

function charter(pageId: string) {
  return {
    command: 'create_page',
    requestId: crypto.randomUUID(),
    pageId,
    type: 'charter',
    jdArea: AREA,
    slug: `charter-${pageId.slice(0, 8)}`,
    title: 'Gateway charter',
    parentId: null,
    frontmatter: { applies_to: null },
    bodyMd: WITHOUT_ROADMAP,
    status: 'draft',
  };
}

async function apiNamesTheMissingHeading(db: Database): Promise<void> {
  const editor = await person(db, 'sections-api', 'editor', AREA);
  const sent = await post(
    db,
    editor.email,
    '/api/pages/commands/create_page',
    charter(crypto.randomUUID()),
  );
  expect(sent.status).toBe(422);
  expect(sent.body).toMatchObject({
    status: 'error',
    reason: 'sections_missing',
    detail: { missing: ['Roadmap'] },
  });
}

async function editorNamesTheMissingHeading(db: Database): Promise<void> {
  const editor = await person(db, 'sections-editor', 'editor', AREA);
  const pageId = crypto.randomUUID();
  await seedPage(db, {
    id: pageId,
    type: 'charter',
    status: 'draft',
    jdArea: AREA,
    slug: 'gateway-charter',
    title: 'Gateway charter',
    bodyMd: `${WITHOUT_ROADMAP}\n## Roadmap\nQ1.`,
    frontmatter: { applies_to: null },
  });
  const form = new URLSearchParams({
    requestId: crypto.randomUUID(),
    expectedVersion: '1',
    title: 'Gateway charter',
    bodyMd: WITHOUT_ROADMAP,
  });
  const sent = await postForm(db, editor.email, `/pages/${pageId}/edit`, form, {
    origin: 'http://localhost',
  });
  const note = new JSDOM(sent.text).window.document.querySelector('[role="note"]');
  expect(note?.textContent).toContain('add the heading Roadmap');
}

describe.skipIf(!testServer)('PO-4 a refusal names the headings a page lacks', () => {
  it('answers sections_missing with the missing headings over the page API', () =>
    withAppDatabase(apiNamesTheMissingHeading));

  it('names the missing heading in the editor', () =>
    withAppDatabase(editorNamesTheMissingHeading));
});
