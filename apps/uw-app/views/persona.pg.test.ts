import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { identitySchema, principalSchema, type Principal } from '@uw/contracts';
import { systemPrincipal } from '@uw/core/principal';
import type { Database } from '@uw/db/client';
import { seedBreakerReading, seedPage } from '@uw/db/test-seed';
import { platformRuns } from '../ports/runs.ts';
import { platformStore } from '../ports/store.ts';
import { fakeWorkflowBinding } from '../runs/testing.ts';
import {
  accepted,
  callerOf,
  command,
  enqueued,
  ian,
  softwareHarness,
  type Scene,
} from '../testing/commands.ts';
import { kernelOn } from '../testing/kernel.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { screenProblems } from '../testing/screen-checks.ts';
import { getHtml, postForm } from '../testing/views.ts';

const IAN = 'ian.lindsley@unfoldingword.org';
const ORIGIN = { origin: 'http://localhost' };

const body = [
  '---',
  'name: builder',
  'description: Builder turns an approved plan into commits.',
  '---',
  'Claim the item, do the work, submit it.',
].join('\n');

async function personaPage(
  db: Database,
  harnessId: string,
  toolset: readonly string[] = ['read_page', 'claim_item'],
): Promise<string> {
  const pageId = randomUUID();
  await seedPage(db, {
    id: pageId,
    type: 'persona',
    status: 'suggested',
    jdArea: '80-89',
    slug: 'persona-builder',
    title: 'Builder',
    bodyMd: body,
    frontmatter: {
      identity: 'agent:builder',
      owner: 'human:00000000-0000-4000-8000-000000000001',
      harness: harnessId,
      toolset,
      run_shape: 'workflow-run',
      engine: 'claude-messages',
      model: 'claude-sonnet-5',
      provider: 'anthropic',
      budget: { monthly_minor: 20000, currency: 'USD' },
      capability: 'build',
      requires_tools: toolset,
      status: 'suggested',
    },
  });
  return pageId;
}

async function pageRow(db: Database, pageId: string) {
  const rows = await db.execute<{
    status: string;
    version: number;
    toolset: string[];
    requires: string[];
  }>(
    sql`SELECT status, version, frontmatter->'toolset' AS toolset, frontmatter->'requires_tools' AS requires FROM pages WHERE id = ${pageId}`,
  );
  return rows[0];
}

function documentOf(text: string): Document {
  return new JSDOM(text).window.document;
}

async function scene(db: Database): Promise<{ scene: Scene; pageId: string }> {
  const made = await softwareHarness(db);
  return { scene: made, pageId: await personaPage(db, made.harnessId) };
}

async function opensOnDashboard(db: Database): Promise<void> {
  const { pageId } = await scene(db);
  const page = await getHtml(db, IAN, `/personas/${pageId}`);
  expect(page.status).toBe(200);
  const document = documentOf(page.text);
  expect(document.querySelector('h1')?.textContent).toBe('Builder');
  const labels = [...document.querySelectorAll('dt')].map((term) => term.textContent);
  expect(labels).toEqual([
    'Runs today',
    'Spend today',
    'Escalation rate',
    'Gate refusals today',
    'Premises held today',
    'Writes today',
  ]);
  expect(page.text).toContain('No runs ended today');
  const missing = await getHtml(db, IAN, `/personas/${randomUUID()}`);
  expect(missing.status).toBe(404);
}

async function activates(db: Database): Promise<void> {
  const { scene: made, pageId } = await scene(db);
  const asEditor = documentOf((await getHtml(db, made.editor.email, `/personas/${pageId}`)).text);
  expect(asEditor.querySelector('form[data-command="activate_persona"]')).toBeNull();
  const document = documentOf((await getHtml(db, IAN, `/personas/${pageId}`)).text);
  const form = document.querySelector('form[data-command="activate_persona"]');
  expect(form?.getAttribute('data-harness')).toBe(made.harnessId);
  const field = (name: string) =>
    form?.querySelector(`input[name="${name}"]`)?.getAttribute('value') ?? '';
  expect(field('pageId')).toBe(pageId);
  const stale = await command(db, { email: IAN }, made.harnessId, 'activate_persona', {
    requestId: randomUUID(),
    pageId,
    expectedVersion: Number(field('expectedVersion')) + 1,
  });
  expect(stale.body['reason']).toBe('stale_version');
  const done = await command(db, { email: IAN }, made.harnessId, 'activate_persona', {
    requestId: randomUUID(),
    pageId,
    expectedVersion: Number(field('expectedVersion')),
  });
  expect(done.body['status']).toBe('accepted');
  expect(await pageRow(db, pageId)).toMatchObject({ status: 'active', version: 2 });
  const after = documentOf((await getHtml(db, IAN, `/personas/${pageId}`)).text);
  expect(after.querySelector('form[data-command="activate_persona"]')).toBeNull();
}

function toolsetForm(verbs: readonly string[], expectedVersion: number): URLSearchParams {
  const form = new URLSearchParams({
    expectedVersion: String(expectedVersion),
    requestId: randomUUID(),
  });
  for (const verb of verbs) form.append('verb', verb);
  return form;
}

async function savesToolset(db: Database): Promise<void> {
  const { pageId } = await scene(db);
  const form = toolsetForm(['read_page', 'search_pages', 'list_gifts', 'approve_gate'], 1);
  const saved = await postForm(db, IAN, `/personas/${pageId}/toolset`, form, ORIGIN);
  expect(saved.status).toBe(200);
  expect(saved.text).toContain('Done.');
  expect(await pageRow(db, pageId)).toEqual({
    status: 'suggested',
    version: 2,
    toolset: ['read_page', 'search_pages'],
    requires: ['read_page', 'search_pages'],
  });
  const stale = await postForm(db, IAN, `/personas/${pageId}/toolset`, toolsetForm([], 1), ORIGIN);
  expect(stale.text).toContain('Stale version');
  expect((await pageRow(db, pageId))?.version).toBe(2);
}

function builderOf(admin: Principal): Principal {
  return principalSchema.parse({
    identity: 'agent:builder',
    kind: 'agent',
    personId: admin.personId,
    email: null,
    grants: [],
    interactive: false,
  });
}

function projected(db: Database, harnessId: string) {
  const builder = identitySchema.parse('agent:builder');
  return platformStore(db).transaction((tx) => tx.personas.read.active(builder, harnessId));
}

async function workingPersona(db: Database) {
  const { scene: made, pageId } = await scene(db);
  const { harnessId } = made;
  const admin = await ian(db);
  const kernel = kernelOn(
    db,
    { now: () => new Date() },
    { runs: platformRuns(fakeWorkflowBinding()) },
  );
  const change = { agentPickup: 'allowed' as const, bracket: 'build_package' as const };
  accepted(
    await kernel.stages.updateStage(callerOf(admin), { harnessId, stageKey: 'package', change }),
  );
  const itemId = await enqueued(db, harnessId, 'Work for the builder');
  const delegation = accepted(
    await kernel.delegations.grant(callerOf(admin), {
      harnessId,
      persona: 'agent:builder',
      capability: 'build',
      expiresAt: null,
      supersedes: null,
    }),
  );
  const activated = await command(db, { email: IAN }, harnessId, 'activate_persona', {
    requestId: randomUUID(),
    pageId,
    expectedVersion: 1,
  });
  expect(activated.body['status']).toBe('accepted');
  await seedBreakerReading(db, { harnessId, at: new Date(), actor: 'agent:system' });
  const beat = accepted(
    await kernel.delegations.beat(callerOf(builderOf(admin)), { delegationId: delegation.id }),
  );
  return {
    made,
    pageId,
    kernel,
    itemId,
    delegationId: delegation.id,
    runner: callerOf(beat.principal),
  };
}

async function editorSaveStopsTheRuns(db: Database): Promise<void> {
  const { made, pageId, kernel, itemId, delegationId, runner } = await workingPersona(db);
  const { harnessId } = made;
  expect(await pageRow(db, pageId)).toMatchObject({ status: 'active', version: 2 });
  expect((await projected(db, harnessId))?.id).toBe(pageId);
  const polled = accepted(await kernel.reads.poll(runner, { harnessId, limit: 50 }));
  expect(polled.map((item) => item.itemId)).toContain(itemId);
  const form = toolsetForm(['read_page', 'claim_item', 'search_pages'], 2);
  const saved = await postForm(db, made.editor.email, `/personas/${pageId}/toolset`, form, ORIGIN);
  expect(saved.status).toBe(200);
  expect(saved.text).toContain('Done.');
  const row = await pageRow(db, pageId);
  expect(row).toMatchObject({ status: 'suggested', version: 3 });
  expect(row?.toolset).toContain('search_pages');
  expect(await projected(db, harnessId)).toBeNull();
  const system = callerOf(systemPrincipal());
  expect(accepted(await kernel.runs.beat(system, { limit: 10 }))).toEqual({
    started: [],
    skipped: [],
  });
  const claimed = await kernel.items.claim(runner, { itemId, delegationId });
  expect(claimed).toEqual({
    status: 'error',
    reason: 'not_permitted',
    detail: { why: 'persona_not_active' },
  });
}

async function delegationsCapped(db: Database): Promise<void> {
  const { scene: made, pageId } = await scene(db);
  const admin = await ian(db);
  const now = new Date();
  await platformStore(db).transaction(async (tx) => {
    for (let n = 1; n <= 52; n += 1) {
      await tx.delegations.write.insert(
        {
          id: randomUUID(),
          personId: admin.personId ?? '',
          persona: identitySchema.parse('agent:builder'),
          harnessId: made.harnessId,
          capability: 'build',
          grantedAt: new Date(now.getTime() - 60_000 + n),
          expiresAt: new Date(now.getTime() + 86_400_000),
          revokedAt: null,
          lapsedAt: null,
          supersedes: null,
        },
        randomUUID(),
      );
    }
  });
  const document = documentOf((await getHtml(db, IAN, `/personas/${pageId}`)).text);
  const table = [...document.querySelectorAll('table')].find((element) =>
    element.querySelector('caption')?.textContent?.includes('live delegations'),
  );
  expect(table?.querySelectorAll('tbody tr')).toHaveLength(50);
  expect(document.body.textContent).toContain('and 2 more live delegations');
}

async function keepsUnofferedEntries(db: Database): Promise<void> {
  const made = await softwareHarness(db);
  const stored = ['read_page', 'list_gifts', 'draft_release', 'claim_item'];
  const pageId = await personaPage(db, made.harnessId, stored);
  const form = toolsetForm(['read_page', 'search_pages', 'list_gifts'], 1);
  const saved = await postForm(db, made.editor.email, `/personas/${pageId}/toolset`, form, ORIGIN);
  expect(saved.text).toContain('Done.');
  const kept = ['read_page', 'list_gifts', 'draft_release', 'search_pages'];
  expect(await pageRow(db, pageId)).toEqual({
    status: 'suggested',
    version: 2,
    toolset: kept,
    requires: kept,
  });
}

async function crossSite(db: Database): Promise<void> {
  const { pageId } = await scene(db);
  const form = toolsetForm(['read_page'], 1);
  const refused = await postForm(db, IAN, `/personas/${pageId}/toolset`, form, {
    origin: 'https://evil.example',
  });
  expect(refused.status).toBe(403);
  const none = await postForm(db, IAN, `/personas/${pageId}/toolset`, form, {});
  expect(none.status).toBe(403);
  expect((await pageRow(db, pageId))?.version).toBe(1);
}

async function rendersCleanly(db: Database): Promise<void> {
  const { pageId } = await scene(db);
  const page = await getHtml(db, IAN, `/personas/${pageId}`);
  expect(await screenProblems(page.text)).toEqual([]);
  const document = documentOf(page.text);
  expect(document.querySelector('meta[name="color-scheme"]')?.getAttribute('content')).toBe(
    'light dark',
  );
  const kindled = [...document.querySelectorAll('main [class*="kindle"]')];
  expect(kindled.map((element) => [element.tagName, element.textContent])).toEqual([
    ['BUTTON', 'Activate'],
  ]);
}

describe.skipIf(!testServer)('the persona view', () => {
  it('the persona view declares both colour schemes and names every control, and Kindle marks only Activate', () =>
    withAppDatabase(rendersCleanly));
  it('PE-4 a persona page opens on its dashboard', () => withAppDatabase(opensOnDashboard));
  it('PE-3 the Activate form activates the persona through the command dispatcher and shows the outcome in place', () =>
    withAppDatabase(activates));
  it('PE-2 the toolset form saves only offered verbs and requires_tools follows', () =>
    withAppDatabase(savesToolset));
  it("an editor's toolset save on an active persona lands it suggested, and neither the beat nor a claim works for it", () =>
    withAppDatabase(editorSaveStopsTheRuns));
  it('the persona view lists 50 live delegations and names how many more there are', () =>
    withAppDatabase(delegationsCapped));
  it('a toolset save keeps the stored entries the editor is not offered, in their stored order', () =>
    withAppDatabase(keepsUnofferedEntries));
  it('a toolset post from another origin, or with no origin, is refused', () =>
    withAppDatabase(crossSite));
});
