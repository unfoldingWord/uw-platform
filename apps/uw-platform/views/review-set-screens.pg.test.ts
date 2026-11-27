import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import { principalSchema } from '@uw/contracts';
import { seedPage } from '@uw/db/test-seed';
import { writePageAsAgent } from '../pages/agent-write.ts';
import { personOn } from '../testing/kernel.ts';
import { person } from '../testing/commands.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { screenProblems } from '../testing/screen-checks.ts';
import { getHtml, postForm } from '../testing/views.ts';

const ORIGIN = { origin: 'http://localhost' };
const AREA = '00-09';
const POLICY = '00000000-0000-4000-8000-000000003d01';
const BODY = 'Two adults are present at every session.\n\nRecords are kept.';

type World = { readonly editor: string; readonly viewer: string };

function documentOf(text: string): Document {
  return new JSDOM(text).window.document;
}

async function world(db: Database): Promise<World> {
  const editor = await person(db, 'review-editor', 'editor', AREA);
  const viewer = await person(db, 'review-viewer', 'viewer', AREA);
  await seedPage(db, {
    id: POLICY,
    type: 'policy',
    status: 'active',
    jdArea: AREA,
    slug: 'sessions',
    title: 'Sessions',
    bodyMd: BODY,
    frontmatter: { enforcement: 'required', effective_from: '2026-01-01' },
  });
  return { editor: editor.email, viewer: viewer.email };
}

const newPath = `/pages/${POLICY}/review-sets/new`;

async function suggested(db: Database, made: World, fields: Record<string, string>) {
  const form = documentOf((await getHtml(db, made.editor, newPath)).text);
  const sent = new URLSearchParams({
    requestId: crypto.randomUUID(),
    baseVersion: form.querySelector('input[name="baseVersion"]')?.getAttribute('value') ?? '',
    name: 'Board review',
    proposed: BODY,
    marked: '',
    ...fields,
  });
  return postForm(db, made.editor, newPath, sent, ORIGIN);
}

function namesTheSuggesterAndStrikesDeletions(document: Document): void {
  expect(document.querySelector('main')?.textContent).not.toContain('human:');
  const struck = document.querySelector('[data-word-changes] del')?.getAttribute('class') ?? '';
  expect(struck.split(' ')).toContain('line-through');
  expect(struck.split(' ')).not.toContain('no-underline');
}

async function suggestReviewAccept(db: Database): Promise<void> {
  const made = await world(db);
  const asking = await getHtml(db, made.editor, newPath);
  expect(asking.status).toBe(200);
  expect(await screenProblems(asking.text)).toEqual([]);
  const posted = await suggested(db, made, {
    proposed: 'Two trained adults are present at each session.\n\nRecords are kept.',
  });
  expect(posted.status).toBe(303);
  const path = posted.headers.get('location') ?? '';
  expect(path).toMatch(new RegExp(`^/pages/${POLICY}/review-sets/[0-9a-f-]{36}$`));
  const review = await getHtml(db, made.editor, path);
  expect(await screenProblems(review.text)).toEqual([]);
  const document = documentOf(review.text);
  const kinds = [...document.querySelectorAll('[data-suggested-change]')].map((row) =>
    row.getAttribute('data-suggested-change'),
  );
  expect(kinds).toEqual(['insertion', 'replacement']);
  namesTheSuggesterAndStrikesDeletions(document);
  const page = documentOf((await getHtml(db, made.viewer, `/pages/${POLICY}`)).text);
  expect(page.querySelector('[data-review-sets-waiting] a')?.getAttribute('href')).toBe(path);
  const asViewer = documentOf((await getHtml(db, made.viewer, path)).text);
  expect(asViewer.querySelector('main form')).toBeNull();
  const sent = new URLSearchParams({
    requestId: crypto.randomUUID(),
    intent: 'accept_review_set',
    revision: '1',
  });
  expect((await postForm(db, made.viewer, path, sent, ORIGIN)).status).toBe(404);
  const accepted = await postForm(db, made.editor, path, sent, ORIGIN);
  expect(accepted.headers.get('location')).toBe(`/pages/${POLICY}?saved=2`);
  const after = documentOf((await getHtml(db, made.editor, `/pages/${POLICY}`)).text);
  expect(after.querySelector('[data-page-body]')?.textContent).toContain(
    'Two trained adults are present at each session.',
  );
  expect(after.querySelector('[data-review-sets-waiting]')).toBeNull();
}

async function importMarkedExport(db: Database): Promise<void> {
  const made = await world(db);
  const marked = BODY.replace('every', '{~~every~>each~~}{>>Plainer.<<}');
  const posted = await suggested(db, made, { marked });
  expect(posted.status).toBe(303);
  const review = documentOf(
    (await getHtml(db, made.editor, posted.headers.get('location') ?? '')).text,
  );
  expect(review.querySelector('[data-suggested-change="replacement"]')?.textContent).toContain(
    'Plainer.',
  );
  const nothing = await suggested(db, made, {});
  expect(nothing.status).toBe(200);
  expect(nothing.text).toContain('there is nothing to suggest');
  const viewer = documentOf((await getHtml(db, made.viewer, newPath)).text);
  expect(viewer.querySelector('main form')).toBeNull();
}

async function agentSuggestionNamesItsPerson(db: Database): Promise<void> {
  await world(db);
  const bound = await person(db, 'review-agent-owner', 'editor', AREA);
  const owner = await personOn(db, bound.id, bound.email, new Date());
  const agent = principalSchema.parse({
    ...owner,
    identity: `agent:${bound.id}/laptop`,
    kind: 'agent',
    email: null,
  });
  const held = await writePageAsAgent(
    db,
    agent,
    {
      pageId: POLICY,
      type: 'policy',
      jdArea: AREA,
      slug: 'sessions',
      title: 'Sessions',
      parentId: null,
      frontmatter: { enforcement: 'required', effective_from: '2026-01-01' },
      bodyMd: BODY.replace('every', 'each'),
      expectedVersion: 1,
    },
    {
      traceId: crypto.randomUUID(),
      at: new Date(),
      instructions: { namesInstructions: () => Promise.resolve(false) },
      writer: null,
    },
  );
  if (!held.ok || held.reviewSetId === undefined) throw new Error('no review set was held');
  const review = await getHtml(db, bound.email, `/pages/${POLICY}/review-sets/${held.reviewSetId}`);
  expect(await screenProblems(review.text)).toEqual([]);
  const band = documentOf(review.text).querySelector('main')?.textContent ?? '';
  expect(band).toContain('An agent for');
  expect(band).not.toContain('agent:');
  expect(documentOf(review.text).querySelector('main [data-person-chip]')).not.toBeNull();
}

describe.skipIf(!testServer)(
  '#197 a person suggests changes and decides a review set on screen',
  () => {
    it('turns an edited text into a review set, lists it on the page, and accepts it as one version', () =>
      withAppDatabase(suggestReviewAccept));

    it("names an agent's suggestion by the person it works for, through the person chip", () =>
      withAppDatabase(agentSuggestionNamesItsPerson));
    it('brings a marked export back as suggested changes, and refuses an unchanged text', () =>
      withAppDatabase(importMarkedExport));
  },
);
