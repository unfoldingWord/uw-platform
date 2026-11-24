import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import { seedGrant } from '@uw/db/test-seed';
import { command, person } from '../testing/commands.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { screenProblems } from '../testing/screen-checks.ts';
import { getHtml } from '../testing/views.ts';
import { agentQueuesPath, newWorkflowPath } from './parts/paths.ts';

const ROWAN = 'rowan.test@unfoldingword.org';

function documentOf(html: string): Document {
  return new JSDOM(html).window.document;
}

async function pageAs(db: Database, email: string, path = newWorkflowPath()) {
  const response = await getHtml(db, email, path);
  return { response, main: documentOf(response.text).querySelector('main') };
}

function areaChoices(main: Element | null): readonly (readonly [string, string])[] {
  return [...(main?.querySelectorAll('select[name="jdArea"] option') ?? [])].map(
    (option) => [option.getAttribute('value') ?? '', option.textContent ?? ''] as const,
  );
}

async function areaAdminSeesOnlyTheirAreas(db: Database): Promise<void> {
  const admin = await person(db, 'new-wf-admin', 'admin', '50-59');
  await seedGrant(db, {
    id: randomUUID(),
    personId: admin.id,
    role: 'editor',
    scopeKind: 'jd_area',
    scopeArea: '80-89',
    grantedAt: new Date(Date.now() - 60_000),
    expiresAt: null,
  });
  const { response, main } = await pageAs(db, admin.email);
  expect(response.status).toBe(200);
  const form = main?.querySelector('form[data-new-workflow]');
  expect(form?.getAttribute('data-command')).toBe('activate_template');
  expect(areaChoices(main)).toEqual([['50-59', '50-59 Innovation & Strategy']]);
  expect(main?.querySelector('input[name="title"]')?.hasAttribute('required')).toBe(true);
  expect(main?.querySelector('input[name="repository"]')?.hasAttribute('required')).toBe(false);
  expect(main?.textContent).toContain('its issues can become items');
  const crumbs = documentOf(response.text).querySelector('nav[aria-label="Breadcrumb"]');
  expect(crumbs?.textContent).toContain('New Workflow');
  expect(crumbs?.querySelector(`a[href="${agentQueuesPath()}"]`)).not.toBeNull();
  expect(await screenProblems(response.text)).toEqual([]);
}

async function orgAdminSeesEveryArea(db: Database): Promise<void> {
  const { main } = await pageAs(db, ROWAN);
  const choices = areaChoices(main);
  expect(choices.map(([code]) => code)).toEqual([
    '00-09',
    '10-19',
    '20-29',
    '30-39',
    '40-49',
    '50-59',
    '60-69',
    '70-79',
    '80-89',
    '90-99',
  ]);
  expect(choices.find(([code]) => code === '70-79')?.[1]).toBe('70-79 Field Programs');
}

async function templatesAreChoices(db: Database): Promise<void> {
  const { main } = await pageAs(db, ROWAN);
  const radios = [...(main?.querySelectorAll('input[name="template"]') ?? [])];
  expect(radios.map((radio) => radio.getAttribute('value'))).toEqual([
    'software',
    'bml',
    'check-only',
  ]);
  expect(radios.map((radio) => radio.hasAttribute('checked'))).toEqual([true, false, false]);
  const texts = radios.map((radio) => radio.closest('label')?.textContent ?? '');
  expect(texts[0]).toContain('Software delivery');
  expect(texts[0]).toContain('8 stages');
  expect(texts[2]).toContain('2 stages');
}

async function nonAdminIsToldWhy(db: Database): Promise<void> {
  const editor = await person(db, 'new-wf-editor', 'editor', '80-89');
  const { response, main } = await pageAs(db, editor.email);
  expect(response.status).toBe(200);
  expect(main?.querySelector('form')).toBeNull();
  expect(main?.textContent).toContain('Only an area admin can create a workflow');
  expect(await screenProblems(response.text)).toEqual([]);
}

async function landingOffersItToAdminsOnly(db: Database): Promise<void> {
  const viewer = await person(db, 'new-wf-viewer', 'viewer', '80-89');
  const link = (main: Element | null) => main?.querySelector(`a[href="${newWorkflowPath()}"]`);
  expect(link((await pageAs(db, ROWAN, agentQueuesPath())).main)?.textContent).toBe('New workflow');
  expect(link((await pageAs(db, viewer.email, agentQueuesPath())).main)).toBeNull();
}

async function createdWorkflowAppearsForTheArea(db: Database): Promise<void> {
  const admin = await person(db, 'new-wf-maker', 'admin', '40-49');
  const editor = await person(db, 'new-wf-colleague', 'editor', '40-49');
  const outsider = await person(db, 'new-wf-outsider', 'viewer', '20-29');
  const harnessId = randomUUID();
  const sent = await command(db, admin, harnessId, 'activate_template', {
    requestId: randomUUID(),
    harnessKey: 'site-copy',
    title: 'Site copy',
    jdArea: '40-49',
    template: 'check-only',
    repository: 'unfoldingWord/site-copy',
  });
  expect(sent.body['status']).toBe('accepted');
  const named = (main: Element | null) => main?.textContent?.includes('Site copy') ?? false;
  expect(named((await pageAs(db, editor.email, agentQueuesPath())).main)).toBe(true);
  expect(named((await pageAs(db, outsider.email, agentQueuesPath())).main)).toBe(false);
}

async function aResentCreateMakesOneWorkflow(db: Database): Promise<void> {
  const admin = await person(db, 'new-wf-resender', 'admin', '40-49');
  const harnessId = randomUUID();
  const body = {
    requestId: randomUUID(),
    harnessKey: 'resent',
    title: 'Resent',
    jdArea: '40-49',
    template: 'check-only',
    repository: null,
  };
  const first = await command(db, admin, harnessId, 'activate_template', body);
  const again = await command(db, admin, harnessId, 'activate_template', body);
  expect([first.body['status'], again.body['status']]).toEqual(['accepted', 'accepted']);
  const rows = await db.execute<{ readonly count: number }>(
    sql`SELECT count(*)::int AS count FROM harnesses WHERE key = 'resent'`,
  );
  expect(rows[0]?.count).toBe(1);
}

describe.skipIf(!testServer)('#111 create a new workflow', () => {
  it('shows an area admin a form offering only the areas they administer', () =>
    withAppDatabase(areaAdminSeesOnlyTheirAreas));

  it('offers an org admin every area, named from the platform areas', () =>
    withAppDatabase(orgAdminSeesEveryArea));

  it('offers each template with its stage count, software first and chosen', () =>
    withAppDatabase(templatesAreChoices));

  it('tells a person who is not an area admin why there is no form', () =>
    withAppDatabase(nonAdminIsToldWhy));

  it('puts New workflow on the landing page for admins only', () =>
    withAppDatabase(landingOffersItToAdminsOnly));

  it('answers a resent create with its first answer and makes one workflow', () =>
    withAppDatabase(aResentCreateMakesOneWorkflow));

  it('lists a created workflow for others in its area and not outside it', () =>
    withAppDatabase(createdWorkflowAppearsForTheArea));
});
