import { randomUUID } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import { activateDashboard } from '../measures/activation.ts';
import { saveMeasure } from '../measures/authoring.ts';
import { dashboardPageOf } from '../measures/measure-pages.ts';
import { addRefusedHosts, latestRunOf } from '../measures/runs.ts';
import { printPage } from '../pdf/print-targets.ts';
import { fakeBrowser } from '../testing/browser.ts';
import { collectionsAt } from '../testing/collections.ts';
import {
  covertlyServedProject,
  day,
  observe,
  readWorld,
  rewriteBody,
  savedDashboard,
  scoredMeasure,
  type Observation,
  type ReadWorld,
} from '../testing/measure-reads.ts';
import { agentOf, forceActive, MEASURE_AREA } from '../testing/measure-world.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { screenProblems } from '../testing/screen-checks.ts';
import { getHtml, getWithBindings } from '../testing/views.ts';

type Scene = ReadWorld & { readonly dashboardId: string; readonly cardId: string };

async function withCard(world: ReadWorld): Promise<string> {
  const panels = [
    { kind: 'figure', measure: world.measureId, metric: 'latest_score' },
    { kind: 'status', measure: world.measureId },
  ] as const;
  const cardId = await savedDashboard(world, { kind: 'host', descendants: true }, panels);
  const request = {
    db: world.db,
    actor: agentOf(world.admin),
    traceId: randomUUID(),
    at: collectionsAt,
  };
  const saved = await saveMeasure(request, {
    measureId: world.measureId,
    expectedVersion: 1,
    jdArea: MEASURE_AREA,
    title: 'GEO score of our websites',
    slug: 'geo-score',
    bodyMd: 'How findable our websites are.',
    measure: { ...scoredMeasure, report_card: cardId },
  });
  if (!saved.ok) throw new Error(saved.reason);
  return cardId;
}

async function scene(db: Database): Promise<Scene> {
  const world = await readWorld(db);
  const { door43, uw, hidden } = world.sites;
  const first = new Map<string, Observation>([
    [door43, { score: 60, fixes: ['Add a sitemap'] }],
    [uw, { score: 70, fixes: ['Describe each page'] }],
    [hidden, { score: 10 }],
  ]);
  await observe(world, { kind: 'scheduled', at: day(1) }, first);
  const second = new Map<string, Observation>([
    [door43, 'timed_out'],
    [uw, { score: 90, fixes: ['Name each image'] }],
    [hidden, { score: 20 }],
  ]);
  await observe(world, { kind: 'scheduled', at: day(2), toolVersion: '5.0.0' }, second);
  const m = world.measureId;
  const dashboardId = await savedDashboard(
    world,
    { kind: 'organization', resource_kind: 'website' },
    [
      { kind: 'figure', measure: m, metric: 'average_score' },
      { kind: 'bars', measure: m, metric: 'latest_score' },
      {
        kind: 'table',
        measure: m,
        values: [
          { value: 'score', threshold: { op: 'at_least', threshold: 95 } },
          { value: 'band' },
        ],
      },
      { kind: 'trend', measure: m, metric: 'score_over_time' },
      { kind: 'list', measure: m, value: 'fixes' },
      { kind: 'status', measure: m },
    ],
  );
  return { ...world, dashboardId, cardId: await withCard(world) };
}

async function activeCard(world: Scene): Promise<void> {
  const card = await dashboardPageOf(world.db, world.cardId);
  const command = {
    command: 'activate_dashboard' as const,
    requestId: randomUUID(),
    dashboardId: world.cardId,
    expectedVersion: card?.version ?? 0,
  };
  const context = { traceId: randomUUID(), at: collectionsAt };
  const activated = await activateDashboard(world.db, world.admin, command, context);
  if (!activated.ok) throw new Error(`dashboard refused: ${activated.reason}`);
}

function uniqueIds(document: Document): boolean {
  const ids = [...document.querySelectorAll('[id]')].map((element) => element.id);
  return new Set(ids).size === ids.length;
}

function documentOf(text: string): Document {
  return new JSDOM(text).window.document;
}

async function screen(world: Scene, email: string | null, path: string) {
  const html = await getHtml(world.db, email ?? '', path);
  expect(html.status, path).toBe(200);
  expect(await screenProblems(html.text), path).toEqual([]);
  return { text: html.text, document: documentOf(html.text) };
}

function insideScroll(document: Document): boolean {
  return [...document.querySelectorAll('main table, main svg[role]')].every(
    (element) => element.closest('.overflow-x-auto') !== null,
  );
}

async function drawsEveryPanel(db: Database): Promise<void> {
  const world = await scene(db);
  const read = await screen(world, world.admin.email, `/pages/${world.dashboardId}`);
  const { document, text } = read;
  expect(document.querySelector('[data-shape="overview"]')).not.toBeNull();
  const kinds = [...document.querySelectorAll('[data-panel]')].map((each) =>
    each.getAttribute('data-panel'),
  );
  expect(kinds).toEqual(['figure', 'bars', 'table', 'trend', 'list', 'status']);
  expect(text).toContain('1 of 2 scored, 1 timed out');
  expect(text).toContain('Under 95');
  expect(text).toContain('Name each image');
  expect(text).toContain('The line breaks where the tool changed from 4.19.10 to 5.0.0.');
  expect(text).not.toContain('Add a sitemap');
  expect(text).toContain('Door43, not scored: timed out');
  expect(text).not.toContain('0 items');
  expect(document.querySelectorAll('svg[role="img"]').length).toBeGreaterThan(1);
  expect(document.querySelector('[style]')).toBeNull();
  expect(insideScroll(document)).toBe(true);
  expect(text).not.toContain('Hidden site');
  const wide = await screen(world, world.wide.email, `/pages/${world.dashboardId}`);
  expect(wide.text).toContain('Hidden site');
  expect(wide.text).toContain('2 of 3 scored, 1 timed out');
}

async function showsReportCards(db: Database): Promise<void> {
  const world = await scene(db);
  const path = `/collections/project/rows/${world.project}`;
  const selector = `[data-report-card="${world.cardId}"]`;
  const suggested = await screen(world, world.admin.email, path);
  expect(suggested.document.querySelector(selector)).toBeNull();
  await forceActive(world, world.measureId);
  const measureOnly = await screen(world, world.admin.email, path);
  expect(measureOnly.document.querySelector(selector)).toBeNull();
  await activeCard(world);
  const project = await screen(world, world.admin.email, path);
  const card = project.document.querySelector(selector);
  expect(card?.textContent).toContain('90');
  const program = await screen(world, world.admin.email, `/pages/${world.program}`);
  expect(program.document.querySelector(`[data-report-card="${world.cardId}"]`)).not.toBeNull();
  const cardPage = await screen(world, world.admin.email, `/pages/${world.cardId}`);
  expect(cardPage.document.querySelectorAll('[data-page-body] [data-embed-notice]')).toHaveLength(
    1,
  );
}

async function hidesCardOfUnreadableResources(db: Database): Promise<void> {
  const world = await scene(db);
  const project = await covertlyServedProject(world);
  const path = `/collections/project/rows/${project}`;
  const selector = `[data-report-card="${world.cardId}"]`;
  await activeCard(world);
  const cardOnly = await screen(world, world.wide.email, path);
  expect(cardOnly.document.querySelector(selector)).toBeNull();
  await forceActive(world, world.measureId);
  const admin = await screen(world, world.admin.email, path);
  expect(admin.document.querySelector(selector)).toBeNull();
  const wide = await screen(world, world.wide.email, path);
  expect(wide.document.querySelector(selector)).not.toBeNull();
}

async function showsMeasureControls(db: Database): Promise<void> {
  const world = await scene(db);
  const admin = await screen(world, world.admin.email, `/pages/${world.measureId}`);
  expect(admin.text).toContain('geo audit --url https://door43.org/ --format json');
  expect(admin.text).toContain('Waiting for a trial');
  const forms = [...admin.document.querySelectorAll('form[data-command]')].map((form) =>
    form.getAttribute('data-command'),
  );
  expect(forms).toEqual(['run_measure_trial', 'activate_measure', 'run_measure_now']);
  const activate = admin.document.querySelector('form[data-command="activate_measure"]');
  const offered = [...(activate?.querySelectorAll('input[type="checkbox"]') ?? [])].map((box) =>
    box.getAttribute('name'),
  );
  expect(offered.sort()).toEqual(
    [`dashboard.${world.dashboardId}`, `dashboard.${world.cardId}`].sort(),
  );
  expect(admin.text).toContain('Trial required');
  const editor = await screen(world, world.editor.email, `/pages/${world.measureId}`);
  expect(editor.text).toContain('Not permitted');
}

async function hidesRefusedHostsOfHiddenSites(db: Database): Promise<void> {
  const world = await scene(db);
  const run = await latestRunOf(db, world.measureId);
  await addRefusedHosts(db, run?.id ?? '', ['cdn.hidden.example.org']);
  const admin = await screen(world, world.admin.email, `/pages/${world.measureId}`);
  expect(admin.text).not.toContain('cdn.hidden.example.org');
  const wide = await screen(world, world.wide.email, `/pages/${world.measureId}`);
  expect(wide.text).toContain('Refused hosts: cdn.hidden.example.org.');
}

async function listsMeasures(db: Database): Promise<void> {
  const world = await scene(db);
  const listed = await screen(world, world.admin.email, '/measures');
  expect(listed.text).toContain('GEO score of our websites');
  expect(listed.text).toContain('Website findability');
  const hidden = await screen(world, world.stranger.email, '/measures');
  expect(hidden.text).not.toContain('GEO score of our websites');
}

async function exportsReadableRows(db: Database): Promise<void> {
  const world = await scene(db);
  const get = (email: string | null, path: string) =>
    getWithBindings(world.db, email ?? '', path, {});
  const csv = await get(
    world.admin.email,
    `/api/measures/dashboards/${world.dashboardId}/panels/1`,
  );
  const text = new TextDecoder().decode(csv.bytes);
  expect(csv.headers.get('content-type')).toBe('text/csv; charset=utf-8');
  expect(text.split('\n')[0]).toBe('Resource,Score,Observed');
  expect(text).toContain('unfoldingWord,90,');
  expect(text).not.toContain('Hidden site');
  const trend = await get(
    world.admin.email,
    `/api/measures/dashboards/${world.dashboardId}/panels/3`,
  );
  const series = new TextDecoder().decode(trend.bytes).split('\n');
  expect(series[0]).toBe('Resource,Observed,Score over time,Tool version');
  expect(series.slice(1).map((line) => line.replace(/,[^,]*,/, ',at,'))).toEqual([
    'Door43,at,60,4.19.10',
    'unfoldingWord,at,70,4.19.10',
    'unfoldingWord,at,90,5.0.0',
  ]);
  expect(new Set(series.slice(1).map((line) => line.split(',')[1])).size).toBe(2);
  const json = await get(world.admin.email, `/api/measures/${world.measureId}`);
  expect(JSON.parse(new TextDecoder().decode(json.bytes))).toMatchObject({
    measureId: world.measureId,
  });
  expect((await get(world.stranger.email, `/api/measures/${world.measureId}`)).status).toBe(404);
  expect(
    (await get(world.stranger.email, `/api/measures/dashboards/${world.dashboardId}`)).status,
  ).toBe(404);
}

async function printsPanelsAsVector(db: Database): Promise<void> {
  const world = await scene(db);
  const browser = fakeBrowser();
  const path = `/pages/${world.dashboardId}?format=pdf`;
  const sent = await getWithBindings(world.db, world.admin.email ?? '', path, { BROWSER: browser });
  expect(sent.headers.get('content-type')).toBe('application/pdf');
  const [call] = browser.calls();
  const printed = documentOf(call?.html ?? '');
  expect(printed.querySelector('svg[role="img"]')).not.toBeNull();
  expect(printed.querySelector('form')).toBeNull();
}

async function showsUnreadablePanelInPlace(db: Database): Promise<void> {
  const world = await scene(db);
  const dashboard = await dashboardPageOf(db, world.dashboardId);
  const broken = `\n\`\`\`panel\nkind: pie\nmeasure: ${world.measureId}\n\`\`\`\n`;
  await rewriteBody(world, world.dashboardId, `${dashboard?.bodyMd ?? ''}${broken}`);
  const read = await screen(world, world.admin.email, `/pages/${world.dashboardId}`);
  expect(read.document.querySelectorAll('[data-panel]')).toHaveLength(7);
  expect(read.document.querySelector('[data-panel="unreadable"]')?.textContent).toContain(
    'This panel could not be read',
  );
}

async function keepsSectionIdsApart(db: Database): Promise<void> {
  const world = await scene(db);
  await forceActive(world, world.measureId);
  await activeCard(world);
  await rewriteBody(world, world.project, '## Measures\n\nWhat we track.\n');
  const row = await screen(world, world.admin.email, `/collections/project/rows/${world.project}`);
  expect(row.document.querySelector(`[data-report-card="${world.cardId}"]`)).not.toBeNull();
  expect(uniqueIds(row.document)).toBe(true);
  await rewriteBody(world, world.measureId, '## Measure state\n\nHow findable.\n');
  const measure = await screen(world, world.admin.email, `/pages/${world.measureId}`);
  expect(uniqueIds(measure.document)).toBe(true);
}

async function embedsOnScreen(world: Scene, path: string): Promise<void> {
  const read = await screen(world, world.admin.email, path);
  const card = read.document.querySelector(`[data-embed="${world.cardId}"]`);
  expect(card?.querySelector('[data-panel="figure"]')?.textContent).toContain('90');
  expect(card?.textContent).not.toContain('Door43');
  const all = read.document.querySelector(`[data-embed="${world.dashboardId}"]`);
  expect(all?.querySelectorAll('[data-panel]')).toHaveLength(6);
  expect(read.document.querySelector('code.language-panel')).toBeNull();
  expect(uniqueIds(read.document)).toBe(true);
}

async function embedsInPrint(world: Scene): Promise<void> {
  const browser = fakeBrowser();
  const pdf = `/pages/${world.project}?format=pdf`;
  await getWithBindings(world.db, world.admin.email ?? '', pdf, { BROWSER: browser });
  const printed = documentOf(browser.calls()[0]?.html ?? '');
  expect(printed.querySelector(`[data-embed="${world.cardId}"] [data-panel]`)).not.toBeNull();
  expect(printed.querySelector('code.language-panel')).toBeNull();
  const exported = await printPage(world.db, world.admin, world.project, collectionsAt, 'test');
  const sent = documentOf(exported?.bodyHtml ?? '');
  expect(sent.querySelector(`[data-embed="${world.dashboardId}"] [data-panel]`)).not.toBeNull();
  expect(sent.querySelector('code.language-panel')).toBeNull();
}

async function drawsHandEmbeddedDashboards(db: Database): Promise<void> {
  const world = await scene(db);
  const body = `Our sites.\n\n![Card](/pages/${world.cardId})\n\n![All](/pages/${world.dashboardId})\n`;
  await rewriteBody(world, world.project, body);
  await embedsOnScreen(world, `/pages/${world.project}`);
  await embedsOnScreen(world, `/collections/project/rows/${world.project}`);
  await embedsInPrint(world);
}

describe.skipIf(!testServer)('ADR 0036 dashboards, report cards and measures on screen', () => {
  it('draws every panel kind for each reader, leaving out what the reader cannot read', () =>
    withAppDatabase(drawsEveryPanel));

  it('shows the report card only once its measure and dashboard are active', () =>
    withAppDatabase(showsReportCards));

  it('leaves off a report card that only an unreadable resource would reveal', () =>
    withAppDatabase(hidesCardOfUnreadableResources));

  it('shows the tool, the command for each resource and the person controls', () =>
    withAppDatabase(showsMeasureControls));

  it('names refused hosts only to a reader who may read every resource of the run', () =>
    withAppDatabase(hidesRefusedHostsOfHiddenSites));

  it('lists the measures and dashboards the reader may read', () => withAppDatabase(listsMeasures));

  it('exports a panel as CSV and a measure as JSON for the reader only', () =>
    withAppDatabase(exportsReadableRows));

  it('prints a dashboard with its panels as vector art', () =>
    withAppDatabase(printsPanelsAsVector));

  it('shows a panel block that cannot be read in place, with its problem', () =>
    withAppDatabase(showsUnreadablePanelInPlace));

  it('keeps the measure section ids apart from headings in the page body', () =>
    withAppDatabase(keepsSectionIdsApart));

  it('draws a hand-embedded dashboard for the reader, with the host page as its context', () =>
    withAppDatabase(drawsHandEmbeddedDashboards));
});
