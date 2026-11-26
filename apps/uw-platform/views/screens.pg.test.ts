import { readdirSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import { pageReviewSets, pageSuggestedChanges, pageSuggestionSets } from '@uw/db/schema';
import { rewriteItem, seedPage } from '@uw/db/test-seed';
import { clock } from '../github/testing/ship-rig.ts';
import { advanced, enqueuedItem, meteredRun, subscriptionRun } from '../testing/board-world.ts';
import { accepted, callerOf } from '../testing/commands.ts';
import { credentialFor } from '../testing/credentials-scene.ts';
import { gateWorld, type GateWorld } from '../testing/gate-world.ts';
import { kernelOn, personOn } from '../testing/kernel.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { screenProblems } from '../testing/screen-checks.ts';
import { getHtml, type Html } from '../testing/views.ts';
import { ensureBuiltIns } from '../collections/builtins/seed.ts';
import { personWith, rowIn } from '../testing/collections.ts';
import { personByEmail } from '../people/directory.ts';
import { queueExport } from '../pdf/exports.ts';
import { screens, type ScreenEntry } from './registry.ts';

const HOUR = 3_600_000;
const earlier = { now: () => new Date(clock.now().getTime() - 2 * HOUR) };

type Seeded = GateWorld & {
  readonly runId: string;
  readonly credentialId: string;
  readonly programRow: string;
  readonly exportIds: ReadonlyMap<string, string>;
};

type Rendered = { readonly name: string; readonly email: string; readonly page: Html };

async function programRowIn(db: Database): Promise<string> {
  await ensureBuiltIns(db, clock.now());
  const writer = await personWith(db, 'program-writer', [
    { role: 'editor', area: '80-89' },
    { role: 'viewer', area: '00-09' },
  ]);
  return rowIn(db, writer, { collection: 'program', jdArea: '80-89', title: 'Gateway languages' });
}

async function seedPersona(db: Database, harnessId: string, at: Date): Promise<void> {
  await seedPage(db, {
    id: personaPageId,
    type: 'persona',
    status: 'suggested',
    jdArea: '80-89',
    title: 'Builder',
    bodyMd: '---\nname: builder\ndescription: Builder builds.\n---\nBuild the item.',
    frontmatter: personaFrontmatter(harnessId),
    slug: 'screens-persona',
  });
  await db.insert(pageSuggestionSets).values({
    id: suggestionId,
    pageId: personaPageId,
    baseVersion: 1,
    title: 'Builder',
    frontmatter: personaFrontmatter(harnessId),
    bodyMd: 'Build the item, then check it.',
    proposedBy: 'agent:builder',
    proposedAt: at,
    status: 'pending',
  });
  await seedReviewSet(db, at);
}

async function seedReviewSet(db: Database, at: Date): Promise<void> {
  await db.insert(pageReviewSets).values({
    id: reviewSetId,
    pageId: personaPageId,
    name: 'Builder review',
    baseVersion: 1,
    status: 'pending',
    createdBy: 'agent:builder',
    createdAt: at,
    requestId: crypto.randomUUID(),
  });
  await db.insert(pageSuggestedChanges).values({
    id: crypto.randomUUID(),
    reviewSetId,
    position: 0,
    kind: 'replacement',
    startOffset: 51,
    endOffset: 66,
    exact: 'Build the item.',
    prefix: '',
    suffix: '',
    proposedText: 'Build the item, then check it.',
    note: null,
    author: 'agent:builder',
    createdAt: at,
  });
}

async function seededWorld(db: Database): Promise<Seeded> {
  const world = await gateWorld(db);
  const { harnessId } = world.item;
  const kernel = kernelOn(db, earlier);
  await enqueuedItem(kernel, world.rowan, harnessId, 'Draw the icon');
  const built = await enqueuedItem(kernel, world.rowan, harnessId, 'Wire the run host');
  await advanced(kernel, world.rowan, built, 3);
  const at = earlier.now();
  const runId = await meteredRun(db, { harnessId, itemId: built, at }, 'running');
  await subscriptionRun(
    db,
    { harnessId, itemId: built, at },
    `agent:${world.kim.personId ?? ''}/laptop`,
  );
  const lapsing = new Date(at.getTime() + HOUR);
  accepted(
    await kernel.delegations.grant(callerOf(world.kim), {
      maxTier: null,
      harnessId,
      persona: 'agent:scout',
      capability: 'build',
      expiresAt: lapsing,
      supersedes: null,
    }),
  );
  await rewriteItem(db, world.item.itemId, { riskTier: 'high', riskDomains: ['acl'] });
  await seedPage(db, {
    id: '00000000-0000-4000-8000-00000000c0de',
    type: 'learning',
    status: 'active',
    jdArea: '80-89',
    title: 'Boards load slowly',
    bodyMd: '- [assumed] boards load slowly',
    frontmatter: { confidence: 'assumed', as_of: '2026-01-01', supersedes: [], review_by: null },
    slug: 'screens-stale-learning',
  });
  await seedPersona(db, harnessId, at);
  const credentialId = await credentialFor(db, world.kimEmail, clock);
  const exportIds = await seededExports(db, [world.kimEmail, world.viewerEmail]);
  return { ...world, runId, credentialId, exportIds, programRow: await programRowIn(db) };
}

async function seededExports(db: Database, emails: readonly string[]) {
  const exportIds = new Map<string, string>();
  for (const email of emails) exportIds.set(email, await seededExport(db, email));
  return exportIds;
}

async function seededExport(db: Database, email: string): Promise<string> {
  const personId = (await personByEmail(db, email))?.personId ?? '';
  const actor = await personOn(db, personId, email, clock.now());
  const { exportId } = await queueExport(db, {
    kind: 'binder',
    title: 'Seeded export',
    reference: 'Seeded export',
    areas: ['80-89'],
    request: { kind: 'binder', rootPageId: personaPageId },
    actor,
    at: clock.now(),
  });
  return exportId;
}

const personaPageId = '00000000-0000-4000-8000-00000000be11';
const suggestionId = '00000000-0000-4000-8000-00000000be12';
const reviewSetId = '00000000-0000-4000-8000-00000000be13';

function personaFrontmatter(harnessId: string) {
  return {
    identity: 'agent:builder',
    owner: 'human:00000000-0000-4000-8000-000000000001',
    harness: harnessId,
    toolset: ['read_page'],
    run_shape: 'workflow-run',
    engine: 'claude-messages',
    model: 'claude-sonnet-5',
    provider: 'anthropic',
    budget: { monthly_minor: 0, currency: 'USD' },
    capability: 'build',
    requires_tools: ['read_page'],
    status: 'suggested',
  };
}

function pathOf(entry: ScreenEntry, world: Seeded, email: string): string {
  return entry.path
    .replace(':harnessId', world.item.harnessId)
    .replace(':itemId', world.item.itemId)
    .replace(':runId', world.runId)
    .replace(':indicator', 'spend')
    .replace(':pageId', personaPageId)
    .replace(':suggestionId', suggestionId)
    .replace(':reviewSetId', reviewSetId)
    .replace(':category', '81')
    .replace(':area', '80-89')
    .replace(':version', '1')
    .replace(':key', 'program')
    .replace(':viewId', 'c0110000-0000-4000-8000-000000000401')
    .replace(':tier', 'program')
    .replace(':nodeId', world.programRow)
    .replace(':rowId', world.programRow)
    .replace(':personId', world.kim.personId ?? '')
    .replace(':exportId', world.exportIds.get(email) ?? '')
    .replace(':credentialId', world.credentialId);
}

async function renderAll(world: Seeded): Promise<readonly Rendered[]> {
  const rendered: Rendered[] = [];
  for (const email of [world.kimEmail, world.viewerEmail]) {
    for (const entry of screens) {
      const page = await getHtml(world.db, email, pathOf(entry, world, email), {}, clock);
      rendered.push({ name: entry.name, email, page });
    }
  }
  return rendered;
}

async function inScreens(work: (rendered: readonly Rendered[]) => Promise<void>): Promise<void> {
  await withAppDatabase(async (db) => work(await renderAll(await seededWorld(db))));
}

function documentOf(page: Html): Document {
  return new JSDOM(page.text).window.document;
}

async function inTheShell(rendered: readonly Rendered[]): Promise<void> {
  for (const { name, email, page } of rendered) {
    const label = `${name} as ${email}`;
    expect(page.status, label).toBe(name === 'not-found' ? 404 : 200);
    const document = documentOf(page);
    expect(document.querySelector('main#main'), label).not.toBeNull();
    expect(document.querySelector('nav[aria-label]'), label).not.toBeNull();
    expect(await screenProblems(page.text), label).toEqual([]);
  }
}

const arbitraryColour = /\[(?:#|rgb|hsl|oklch|color)/;

async function bothSchemes(rendered: readonly Rendered[]): Promise<void> {
  for (const { name, email, page } of rendered) {
    const label = `${name} as ${email}`;
    const document = documentOf(page);
    const scheme = document.querySelector('meta[name="color-scheme"]');
    expect(scheme?.getAttribute('content'), label).toBe('light dark');
    const scripts = [...document.head.querySelectorAll('script:not([src])')];
    expect(
      scripts.some((script) => (script.textContent ?? '').includes('uw-theme')),
      label,
    ).toBe(true);
    const styled = [...document.querySelectorAll('[style]')];
    expect(styled, label).toHaveLength(0);
    const classes = [...document.querySelectorAll('[class]')].map((el) => el.getAttribute('class'));
    expect(
      classes.filter((value) => arbitraryColour.test(value ?? '')),
      label,
    ).toEqual([]);
  }
}

const fixedWidth = [/\b(?:min-|max-)?w-\[\d/, /\bw-\d{3,}/];

async function phoneWidth(rendered: readonly Rendered[]): Promise<void> {
  for (const { name, email, page } of rendered) {
    const label = `${name} as ${email}`;
    const document = documentOf(page);
    const classes = [...document.querySelectorAll('[class]')].map(
      (el) => el.getAttribute('class') ?? '',
    );
    expect(
      classes.filter((value) => fixedWidth.some((width) => width.test(value))),
      label,
    ).toEqual([]);
    for (const wide of document.querySelectorAll('main table, main svg[role]')) {
      expect(wide.closest('.overflow-x-auto'), label).not.toBeNull();
    }
  }
}

describe.skipIf(!testServer)('every screen', () => {
  it('WB-12 every screen renders inside the shell with an accessible name on every control and visible focus', () =>
    inScreens(inTheShell));
  it('WB-12 every screen declares both colour schemes, carries the theme script and uses token classes only', () =>
    inScreens(bothSchemes));
  it('WB-12 every screen sets no fixed width and keeps wide content scrolling in its own container', () =>
    inScreens(phoneWidth));
});

describe('the registered screens', () => {
  it('WB-12 every file under views/screens is a registered screen', () => {
    const files = readdirSync('apps/uw-platform/views/screens')
      .filter((file) => file.endsWith('.tsx'))
      .map((file) => file.replace(/\.tsx$/, ''))
      .sort();
    expect(screens.map((screen) => screen.name).sort()).toEqual(files);
  });
});
