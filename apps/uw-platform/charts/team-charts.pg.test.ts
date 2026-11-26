import { describe, expect, it } from 'vitest';
import { renderedChartSchema, type RenderedChart } from '@uw/contracts';
import type { Database } from '@uw/db/client';
import type { Clock } from '@uw/harness';
import { hasColourLiteral } from '../../../tools/ui/colour-literals.ts';
import { fakeBrowser } from '../testing/browser.ts';
import { csvRows } from '../testing/csv.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { teamWorld, type TeamWorld } from '../testing/team.ts';
import { getWithBindings } from '../testing/views.ts';
import { chartFilePath, type ChartFileFormat } from '../views/parts/paths.ts';

const clock: Clock = { now: () => new Date('2026-11-26T12:00:00.000Z') };
const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const text = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

function cspProblems(svg: string): string[] {
  return [
    ...(/<style\b|\sstyle="/i.test(svg) ? ['style'] : []),
    ...(/<script\b|\son[a-z]+="/i.test(svg) ? ['script'] : []),
    ...(hasColourLiteral('chart.svg.html', svg) ? ['colour literal'] : []),
  ];
}

async function inWorld(work: (world: TeamWorld) => Promise<void>): Promise<void> {
  await withAppDatabase(async (db: Database) => work(await teamWorld(db)));
}

function fetched(world: TeamWorld, key: string, format: ChartFileFormat, email?: string) {
  const env = format === 'png' ? { BROWSER: fakeBrowser() } : {};
  const path = chartFilePath(key, null, format);
  return getWithBindings(world.db, email ?? world.reader.email, path, env, clock);
}

async function chartOf(world: TeamWorld, key: string, email?: string): Promise<RenderedChart> {
  const file = await fetched(world, key, 'json', email);
  expect(file.status).toBe(200);
  return renderedChartSchema.parse(JSON.parse(text(file.bytes)));
}

function cells(chart: RenderedChart, keys: readonly string[]): (string | number | null)[][] {
  return chart.table.rows.map((row) => keys.map((key) => row[key] ?? null));
}

async function drawsEveryResolvedEdge(world: TeamWorld): Promise<void> {
  const chart = await chartOf(world, 'commitments_network');
  expect(cells(chart, ['from', 'to', 'resolvedBy'])).toEqual([
    ['Ada Example', 'Lee-Anne Placeholder', 'loose_name'],
    ['Ada Example', 'Sam Sample', 'id'],
    ['Sam Sample', 'Ada Example', 'first_name'],
  ]);
  const arrowheads = chart.svg.match(/<path[^>]*class="fill-text-3"/g) ?? [];
  expect(arrowheads).toHaveLength(3);
  expect(cspProblems(chart.svg)).toEqual([]);
  for (const name of ['Ada Example', 'Sam Sample', 'Lee-Anne Placeholder']) {
    expect(chart.svg).toContain(name);
  }
  expect(chart.svg).not.toContain('Kit Hidden');
}

async function reportsTheAmbiguousEntry(world: TeamWorld): Promise<void> {
  const chart = await chartOf(world, 'commitments_network');
  const { excluded } = chart.lineage;
  expect(excluded.entries).toEqual([
    {
      reason: 'ambiguous_name',
      subject: 'Lee-Anne Placeholder',
      named: 'Sam',
      candidates: ['Sam Sample', 'Sam Specimen'],
    },
    { reason: 'unresolved_name', subject: 'Sam Specimen', named: 'Quinn Nobody', candidates: [] },
  ]);
  expect(excluded.reasons).toEqual([
    { reason: 'ambiguous_name', count: 1 },
    { reason: 'unresolved_name', count: 1 },
    { reason: 'person_not_readable', count: 1 },
  ]);
  expect(excluded.count).toBe(3);
  expect(chart.svg).toContain(
    'Left out, ambiguous: Lee-Anne Placeholder named “Sam”, who could be Sam Sample or Sam Specimen.',
  );
  expect(chart.svg).not.toContain('Kit Hidden');
}

async function allocatesByPortfolio(world: TeamWorld): Promise<void> {
  const chart = await chartOf(world, 'staff_allocation');
  expect(cells(chart, ['person', 'target', 'kind', 'portfolio', 'percent'])).toEqual([
    ['Ada Example', 'Program Alpha', 'Program', 'Portfolio One', 60],
    ['Ada Example', 'Portfolio Two', 'Portfolio', 'Portfolio Two', null],
  ]);
  expect(chart.lineage.excluded.entries).toEqual([
    { reason: 'page_not_readable', subject: 'Sam Sample', named: null, candidates: [] },
    { reason: 'page_retired', subject: 'Sam Specimen', named: 'Program Retired', candidates: [] },
  ]);
  expect(cspProblems(chart.svg)).toEqual([]);
  expect(chart.svg).toContain('60%');
  expect(chart.svg).toContain('unspecified');
  expect(chart.svg).not.toContain('Program Hidden');
}

async function countsPeopleByPortfolioAndRing(world: TeamWorld): Promise<void> {
  const chart = await chartOf(world, 'people_and_portfolios');
  expect(cells(chart, ['portfolio', 'ring', 'headcount', 'names'])).toEqual([
    ['Portfolio One', 'Core', 1, 'Ada Example'],
    ['Portfolio One', 'Extended', 1, 'Sam Sample'],
    ['Portfolio One', 'Partner', 0, ''],
    ['Portfolio One', 'No ring', 0, ''],
    ['Portfolio Two', 'Core', 0, ''],
    ['Portfolio Two', 'Extended', 1, 'Sam Sample'],
    ['Portfolio Two', 'Partner', 0, ''],
    ['Portfolio Two', 'No ring', 0, ''],
    ['No portfolio', 'Core', 0, ''],
    ['No portfolio', 'Extended', 0, ''],
    ['No portfolio', 'Partner', 1, 'Lee-Anne Placeholder'],
    ['No portfolio', 'No ring', 4, 'Outsider Example, Reader Example, Rowan Test, Steward Example'],
  ]);
  expect(chart.lineage.excluded.entries).toEqual([
    { reason: 'page_not_readable', subject: 'Sam Specimen', named: null, candidates: [] },
  ]);
  expect(chart.svg).not.toContain('Portfolio Hidden');
}

async function exportsCheckable(world: TeamWorld): Promise<void> {
  for (const key of ['commitments_network', 'staff_allocation', 'people_and_portfolios']) {
    const chart = await chartOf(world, key);
    const csv = await fetched(world, key, 'csv');
    expect(csv.status).toBe(200);
    const [header, ...rows] = csvRows(text(csv.bytes));
    expect(header).toEqual(chart.table.columns.map((column) => column.label));
    expect(rows).toEqual(
      chart.table.rows.map((row) => chart.table.columns.map((c) => String(row[c.key] ?? ''))),
    );
    const png = await fetched(world, key, 'png');
    expect(png.status).toBe(200);
    expect([...png.bytes.slice(0, 8)]).toEqual(signature);
  }
}

async function payloadCarriesNoContactDetails(world: TeamWorld): Promise<void> {
  for (const key of ['commitments_network', 'staff_allocation', 'people_and_portfolios']) {
    const file = await fetched(world, key, 'json');
    expect(text(file.bytes)).not.toMatch(/@example\.org|phone|mailing/i);
  }
}

async function outsiderIsRefused(world: TeamWorld): Promise<void> {
  const file = await fetched(world, 'commitments_network', 'json', world.outsider.email);
  expect(file.status).toBe(403);
  expect(JSON.parse(text(file.bytes))).toMatchObject({ reason: 'not_permitted' });
}

describe.skipIf(!testServer)('#200 the team charts drawn from platform data', () => {
  it('#200 the commitments network draws every resolved edge', () =>
    inWorld(drawsEveryResolvedEdge));
  it('#200 an ambiguous entry is left out and listed in the data-quality note with its candidates', () =>
    inWorld(reportsTheAmbiguousEntry));
  it('#200 staff allocation draws each person to a program or portfolio with its percent, reporting hidden and retired pages', () =>
    inWorld(allocatesByPortfolio));
  it('#200 people and portfolios counts people by portfolio and ring', () =>
    inWorld(countsPeopleByPortfolioAndRing));
  it('#200 each team chart exports CSV equal to its rows and a PNG', () =>
    inWorld(exportsCheckable));
  it('#200 a team chart payload carries display names and no contact details', () =>
    inWorld(payloadCarriesNoContactDetails));
  it('#200 a person who cannot read the directory is refused the team charts', () =>
    inWorld(outsiderIsRefused));
});
