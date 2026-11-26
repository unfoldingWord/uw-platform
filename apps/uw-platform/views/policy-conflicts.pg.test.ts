import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import { pages } from '@uw/db/schema';
import { rewritePageStatus, seedPage } from '@uw/db/test-seed';
import { person } from '../testing/commands.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { getHtml } from '../testing/views.ts';

const AREA = '00-09';
const HIDDEN = '10-19';
const PROGRAM = '00000000-0000-4000-8000-000000003b01';
const ORG_RULE = '00000000-0000-4000-8000-000000003b02';
const PROGRAM_RULE = '00000000-0000-4000-8000-000000003b03';
const from = { effective_from: '2026-01-01' };

function documentOf(text: string): Document {
  return new JSDOM(text).window.document;
}

function policy(id: string, title: string, frontmatter: Readonly<Record<string, unknown>>) {
  return {
    id,
    type: 'policy' as const,
    status: 'active' as const,
    jdArea: AREA,
    slug: `conflict-${id.slice(-4)}`,
    title,
    bodyMd: `${title}.`,
    frontmatter: { ...frontmatter },
  };
}

async function world(db: Database): Promise<string> {
  const viewer = await person(db, 'conflict-viewer', 'viewer', AREA);
  await seedPage(db, {
    id: PROGRAM,
    type: 'program',
    status: 'active',
    jdArea: AREA,
    slug: 'gateway',
    title: 'Gateway languages',
    bodyMd: '',
  });
  const programRule = { enforcement: 'default', applies_to: PROGRAM, ...from };
  await seedPage(db, policy(PROGRAM_RULE, 'Program rule', programRule));
  const orgRule = { enforcement: 'default', supersedes: [PROGRAM_RULE], ...from };
  await seedPage(db, policy(ORG_RULE, 'Organization rule', orgRule));
  return viewer.email;
}

async function upwardSupersessionShownOnBoth(db: Database): Promise<void> {
  const viewer = await world(db);
  for (const id of [ORG_RULE, PROGRAM_RULE]) {
    const page = documentOf((await getHtml(db, viewer, `/pages/${id}`)).text);
    const note = page.querySelector('[data-policy-conflicts]')?.textContent ?? '';
    expect(note).toContain('Organization rule tries to replace Program rule');
    expect(note).toContain('is not above it');
  }
  const list = documentOf((await getHtml(db, viewer, '/wiki/policies')).text);
  const counts = [
    ...(list.querySelectorAll('main table')[0]?.querySelectorAll('tbody tr') ?? []),
  ].map((row) => [...row.querySelectorAll('td, th')].map((cell) => cell.textContent.trim()).at(-1));
  expect(counts).toEqual(['1', '1']);
}

async function retiredTargetKeepsItsLevel(db: Database): Promise<void> {
  const viewer = await world(db);
  await rewritePageStatus(db, PROGRAM, 'retired');
  const page = documentOf((await getHtml(db, viewer, `/pages/${PROGRAM_RULE}`)).text);
  const facts = [...page.querySelectorAll('[data-page-facts] li')].map((item) =>
    item.textContent.replace(/\s+/g, ' ').trim(),
  );
  expect(facts).toContain('LevelProgram');
  expect(facts.find((fact) => fact.startsWith('Applies to'))).toContain('(retired)');
}

async function listedPastUnreadableOnes(db: Database): Promise<void> {
  const viewer = await world(db);
  const unreadable = Array.from({ length: 201 }, (_, n) => ({
    id: `00000000-0000-4000-9000-${String(n).padStart(12, '0')}`,
    type: 'policy' as const,
    jdArea: HIDDEN,
    slug: `hidden-${String(n)}`,
    title: `A ${String(n)}`,
    parentId: null,
    frontmatter: { enforcement: 'default', ...from },
    bodyMd: '',
    version: 1,
    status: 'active' as const,
  }));
  await db.insert(pages).values(unreadable);
  const list = documentOf((await getHtml(db, viewer, '/wiki/policies')).text);
  const titles = [
    ...(list.querySelectorAll('main table')[0]?.querySelectorAll('tbody tr') ?? []),
  ].map((row) => row.querySelector('a')?.textContent);
  expect(titles).toEqual(['Organization rule', 'Program rule']);
}

describe.skipIf(!testServer)('PO-6 conflicts and levels are shown as they stand', () => {
  it('shows an organization policy naming a program policy on both pages and in the list', () =>
    withAppDatabase(upwardSupersessionShownOnBoth));

  it('keeps a policy at its target level after the target is retired', () =>
    withAppDatabase(retiredTargetKeepsItsLevel));

  it('lists the readable policies however many unreadable ones sort before them', () =>
    withAppDatabase(listedPastUnreadableOnes));
});
