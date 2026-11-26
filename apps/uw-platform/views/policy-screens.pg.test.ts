import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { pageSuggestionSets } from '@uw/db/schema';
import type { Database } from '@uw/db/client';
import { rewritePageBody, seedPage } from '@uw/db/test-seed';
import { person } from '../testing/commands.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { screenProblems } from '../testing/screen-checks.ts';
import { getHtml, postForm } from '../testing/views.ts';

const ORIGIN = { origin: 'http://localhost' };
const AREA = '00-09';
const REQUIRED = '00000000-0000-4000-8000-000000003a01';
const LOWER = '00000000-0000-4000-8000-000000003a02';
const PROGRAM = '00000000-0000-4000-8000-000000003a03';
const SUGGESTION = '00000000-0000-4000-8000-000000003a04';
const from = { effective_from: '2026-01-01' };

type World = { readonly editor: string; readonly viewer: string };

function documentOf(text: string): Document {
  return new JSDOM(text).window.document;
}

function policy(id: string, title: string, frontmatter: Readonly<Record<string, unknown>>) {
  return {
    id,
    type: 'policy' as const,
    status: 'active' as const,
    jdArea: AREA,
    slug: `policy-${id.slice(-4)}`,
    title,
    bodyMd: `${title}.`,
    frontmatter: { ...frontmatter },
  };
}

async function world(db: Database): Promise<World> {
  const editor = await person(db, 'policy-editor', 'editor', AREA);
  const viewer = await person(db, 'policy-viewer', 'viewer', AREA);
  await seedPage(db, {
    id: PROGRAM,
    type: 'program',
    status: 'active',
    jdArea: AREA,
    slug: 'gateway',
    title: 'Gateway languages',
    bodyMd: '',
  });
  await seedPage(db, policy(REQUIRED, 'Safeguarding', { enforcement: 'required', ...from }));
  const lower = { enforcement: 'default', applies_to: PROGRAM, supersedes: [REQUIRED], ...from };
  await seedPage(db, policy(LOWER, 'Lighter safeguarding', lower));
  await db.insert(pageSuggestionSets).values({
    id: SUGGESTION,
    pageId: REQUIRED,
    baseVersion: 1,
    title: 'Safeguarding',
    frontmatter: { enforcement: 'required', ...from },
    bodyMd: 'Safeguarding, with two named adults.',
    proposedBy: 'agent:builder',
    proposedAt: new Date('2026-11-20T10:00:00.000Z'),
    status: 'pending',
  });
  return { editor: editor.email, viewer: viewer.email };
}

function factsOf(document: Document): Readonly<Record<string, string>> {
  const items = [...document.querySelectorAll('[data-page-facts] li')];
  return Object.fromEntries(
    items.map((item) => {
      const [label, ...rest] = [...item.children].map((child) => child.textContent.trim());
      return [label ?? '', rest.join(' ')];
    }),
  );
}

async function policyPageShowsItsLevelAndConflict(db: Database): Promise<void> {
  const made = await world(db);
  const lower = await getHtml(db, made.viewer, `/pages/${LOWER}`);
  expect(lower.status).toBe(200);
  expect(await screenProblems(lower.text)).toEqual([]);
  const document = documentOf(lower.text);
  expect(factsOf(document)).toMatchObject({
    Level: 'Program',
    'Applies to': 'Gateway languages',
    Enforcement: 'Default: a lower policy may replace it',
    'In force': 'From 2026-01-01',
  });
  const conflict = document.querySelector('[data-policy-conflicts]')?.textContent ?? '';
  expect(conflict).toContain('Lighter safeguarding tries to replace Safeguarding');
  expect(conflict).toContain('required, so it still holds');
  const required = documentOf((await getHtml(db, made.viewer, `/pages/${REQUIRED}`)).text);
  expect(factsOf(required)).toMatchObject({
    Level: 'Whole organization',
    'Applies to': 'Everyone',
  });
  expect(required.querySelector('[data-policy-conflicts]')?.textContent).toContain(
    'Lighter safeguarding tries to replace Safeguarding',
  );
  const waiting = required.querySelector('[data-suggestions-waiting] a');
  expect(waiting?.getAttribute('href')).toBe(`/pages/${REQUIRED}/suggestions/${SUGGESTION}`);
}

async function reviewAndAccept(db: Database): Promise<void> {
  const made = await world(db);
  const path = `/pages/${REQUIRED}/suggestions/${SUGGESTION}`;
  const asViewer = documentOf((await getHtml(db, made.viewer, path)).text);
  expect(asViewer.querySelector('main form')).toBeNull();
  const review = await getHtml(db, made.editor, path);
  expect(review.status).toBe(200);
  expect(await screenProblems(review.text)).toEqual([]);
  const document = documentOf(review.text);
  expect(document.querySelector('[data-changes] ins')?.textContent).toBe(
    'Safeguarding, with two named adults.',
  );
  const accept = document.querySelector('button[name="intent"][value="accept_suggestion"]');
  expect(accept?.textContent.trim()).toBe('Accept the change');
  expect(document.querySelector('input[name="revision"]')?.getAttribute('value')).toBe('1');
  const sent = new URLSearchParams({
    requestId: crypto.randomUUID(),
    intent: 'accept_suggestion',
    revision: '1',
  });
  const posted = await postForm(db, made.editor, path, sent, ORIGIN);
  expect(posted.status).toBe(303);
  expect(posted.headers.get('location')).toBe(`/pages/${REQUIRED}?saved=2`);
  const after = documentOf((await getHtml(db, made.editor, `/pages/${REQUIRED}`)).text);
  expect(after.querySelector('[data-page-body]')?.textContent).toContain('two named adults');
  expect(after.querySelector('[data-suggestions-waiting]')).toBeNull();
  const decided = documentOf((await getHtml(db, made.editor, path)).text);
  expect(decided.querySelector('main form')).toBeNull();
}

async function rejectLeavesThePage(db: Database): Promise<void> {
  const made = await world(db);
  const path = `/pages/${REQUIRED}/suggestions/${SUGGESTION}`;
  const sent = new URLSearchParams({
    requestId: crypto.randomUUID(),
    intent: 'reject_suggestion',
    revision: '1',
  });
  const posted = await postForm(db, made.editor, path, sent, ORIGIN);
  expect(posted.headers.get('location')).toBe(`/pages/${REQUIRED}`);
  const after = documentOf((await getHtml(db, made.editor, `/pages/${REQUIRED}`)).text);
  expect(after.querySelector('[data-page-body]')?.textContent).toContain('Safeguarding.');
}

async function policiesListed(db: Database): Promise<void> {
  const made = await world(db);
  const page = await getHtml(db, made.viewer, '/wiki/policies');
  expect(page.status).toBe(200);
  expect(await screenProblems(page.text)).toEqual([]);
  const rows = [...documentOf(page.text).querySelectorAll('main table')].at(0);
  const cells = [...(rows?.querySelectorAll('tbody tr') ?? [])].map((row) =>
    [...row.querySelectorAll('td, th')].map((cell) => cell.textContent.trim()),
  );
  expect(cells).toEqual([
    [
      'Lighter safeguarding',
      'Program',
      'Gateway languages',
      'Default',
      'From 2026-01-01',
      'Live',
      '1',
    ],
    ['Safeguarding', 'Whole organization', 'Everyone', 'Required', 'From 2026-01-01', 'Live', '1'],
  ]);
}

const TEMPLATE = '00000000-0000-4000-8000-000000003a05';

async function confirmFromThePage(db: Database, email: string, path: string): Promise<void> {
  const suggested = documentOf((await getHtml(db, email, path)).text);
  const form = suggested.querySelector(`form[action="${path}/confirm"]`);
  expect(form?.querySelector('button')?.textContent.trim()).toBe('Confirm');
  const sent = new URLSearchParams({ requestId: crypto.randomUUID(), expectedVersion: '1' });
  const confirmed = await postForm(db, email, `${path}/confirm`, sent, ORIGIN);
  expect(confirmed.headers.get('location')).toBe(`${path}?saved=2`);
  const live = documentOf((await getHtml(db, email, path)).text);
  expect(live.querySelector(`form[action="${path}/confirm"]`)).toBeNull();
}

async function copyAndAdoptFromThePage(db: Database): Promise<void> {
  const made = await world(db);
  await seedPage(db, policy(TEMPLATE, 'Work in progress', { enforcement: 'template', ...from }));
  const page = documentOf((await getHtml(db, made.editor, `/pages/${TEMPLATE}`)).text);
  const choices = [...page.querySelectorAll('select[name="appliesTo"] option')];
  expect(choices.map((option) => option.textContent)).toEqual([
    'Whole organization',
    'Gateway languages (program)',
  ]);
  const copy = new URLSearchParams({
    requestId: crypto.randomUUID(),
    intent: 'copy',
    jdArea: AREA,
    title: 'Gateway work in progress',
    appliesTo: PROGRAM,
    enforcement: 'default',
    effectiveFrom: '2026-12-01',
  });
  const made2 = await postForm(db, made.editor, `/pages/${TEMPLATE}/policy`, copy, ORIGIN);
  expect(made2.status).toBe(303);
  const copyPath = made2.headers.get('location') ?? '';
  const replay = await postForm(db, made.editor, `/pages/${TEMPLATE}/policy`, copy, ORIGIN);
  expect(replay.headers.get('location')).toBe(copyPath);
  await confirmFromThePage(db, made.editor, copyPath);
  const copied = documentOf((await getHtml(db, made.editor, copyPath)).text);
  expect(factsOf(copied)).toMatchObject({
    Level: 'Program',
    Template: 'Copied from version 1, the current version',
  });
  await rewritePageBody(db, TEMPLATE, 'Work in progress, at most two.');
  const behind = documentOf((await getHtml(db, made.editor, copyPath)).text);
  const adopt = behind.querySelector('form input[name="intent"][value="adopt"]')?.closest('form');
  expect(adopt?.querySelector('button')?.textContent.trim()).toBe("Adopt the template's new text");
  const sent = new URLSearchParams({
    requestId: crypto.randomUUID(),
    intent: 'adopt',
    expectedVersion: '2',
    templateVersion: '2',
  });
  const adopted = await postForm(db, made.editor, `${copyPath}/policy`, sent, ORIGIN);
  expect(adopted.headers.get('location')).toBe(`${copyPath}?saved=3`);
  const after = documentOf((await getHtml(db, made.editor, copyPath)).text);
  expect(after.querySelector('[data-page-body]')?.textContent).toContain('at most two');
}

describe.skipIf(!testServer)(
  'PO-5 a person copies a template and adopts its update from the page',
  () => {
    it('copies the template into a suggested policy, confirms it, then adopts the template update', () =>
      withAppDatabase(copyAndAdoptFromThePage));
  },
);

describe.skipIf(!testServer)('PO-6 policy screens show level, enforcement and conflicts', () => {
  it('shows a policy level, target, enforcement and dates, and a conflict on both pages', () =>
    withAppDatabase(policyPageShowsItsLevelAndConflict));

  it('lists every readable policy on the Policies screen', () => withAppDatabase(policiesListed));
});

describe.skipIf(!testServer)('PO-7 a person reviews a suggested change', () => {
  it('shows the change as a diff and accepts it as a new version', () =>
    withAppDatabase(reviewAndAccept));

  it('rejects it and leaves the page as it was', () => withAppDatabase(rejectLeavesThePage));
});
