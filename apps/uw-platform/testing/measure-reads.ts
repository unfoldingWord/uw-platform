import { randomUUID } from 'node:crypto';
import type {
  MeasureFrontmatter,
  MeasureRunKind,
  ObservationReason,
  Panel,
  Principal,
} from '@uw/contracts';
import type { Database } from '@uw/db/client';
import { saveDashboard, saveMeasure } from '../measures/authoring.ts';
import { recordObservation } from '../measures/observation-records.ts';
import { finishRun, insertRun } from '../measures/runs.ts';
import { toolHashOf } from '../measures/tool.ts';
import { readPage, updatePage } from '../pages/store.ts';
import { collectionsAt, personWith, rowIn } from './collections.ts';
import {
  agentOf,
  geoMeasure,
  MEASURE_AREA,
  measureWorld,
  PINNED_LOCK,
  type MeasureWorld,
} from './measure-world.ts';

const PROGRAM_AREA = '60-69';

export const scoredMeasure: MeasureFrontmatter = geoMeasure({
  values: [
    { key: 'score', name: 'Score', type: 'number', path: '/score' },
    { key: 'band', name: 'Band', type: 'text', path: '/band' },
    { key: 'fixes', name: 'Suggested fixes', type: 'text_list', path: '/recommendations' },
  ],
  metrics: [
    { key: 'average_score', name: 'Average score', value: 'score', rule: 'average', target: 80 },
    { key: 'latest_score', name: 'Score', value: 'score', rule: 'latest', target: 80 },
    { key: 'score_over_time', name: 'Score over time', value: 'score', rule: 'over_time' },
  ],
});

export type ReadWorld = MeasureWorld & {
  readonly wide: Principal;
  readonly measureId: string;
  readonly sites: { readonly door43: string; readonly uw: string; readonly hidden: string };
  readonly program: string;
  readonly project: string;
};

export type Observation =
  { readonly score: number; readonly fixes?: readonly string[] } | ObservationReason;

async function savedMeasure(world: MeasureWorld): Promise<string> {
  const measureId = randomUUID();
  const request = {
    db: world.db,
    actor: agentOf(world.admin),
    traceId: randomUUID(),
    at: collectionsAt,
  };
  const made = await saveMeasure(request, {
    measureId,
    expectedVersion: null,
    jdArea: MEASURE_AREA,
    title: 'GEO score of our websites',
    slug: 'geo-score',
    bodyMd: 'How findable our websites are.',
    measure: scoredMeasure,
  });
  if (!made.ok) throw new Error(`measure refused: ${made.reason}`);
  return measureId;
}

async function cascade(db: Database, wide: Principal) {
  const program = await rowIn(db, wide, {
    collection: 'program',
    jdArea: MEASURE_AREA,
    title: 'Gateway languages',
  });
  const project = await rowIn(db, wide, {
    collection: 'project',
    jdArea: MEASURE_AREA,
    title: 'unfoldingWord website',
    values: { program },
  });
  return { program, project };
}

export async function readWorld(db: Database): Promise<ReadWorld> {
  const world = await measureWorld(db);
  const wide = await personWith(db, 'measure-wide', [
    { role: 'admin', area: MEASURE_AREA },
    { role: 'editor', area: PROGRAM_AREA },
  ]);
  const { program, project } = await cascade(db, wide);
  const site = (
    title: string,
    address: string,
    jdArea: string,
    values: Record<string, unknown> = {},
  ) =>
    rowIn(db, wide, {
      collection: 'resource',
      jdArea,
      title,
      values: { kind: 'website', address, ...values },
    });
  const sites = {
    door43: await site('Door43', 'https://door43.org/', MEASURE_AREA),
    uw: await site('unfoldingWord', 'https://www.unfoldingword.org/', MEASURE_AREA, {
      serves_project: [project],
    }),
    hidden: await site('Hidden site', 'https://hidden.example.org/', PROGRAM_AREA),
  };
  return { ...world, wide, measureId: await savedMeasure(world), sites, program, project };
}

function valuesOf(observed: Observation) {
  if (typeof observed === 'string') return { values: null, reason: observed };
  const values = { score: observed.score, band: 'good', fixes: [...(observed.fixes ?? [])] };
  return { values, reason: null };
}

export async function observe(
  world: ReadWorld,
  run: { readonly kind: MeasureRunKind; readonly at: Date; readonly toolVersion?: string },
  outcomes: ReadonlyMap<string, Observation>,
): Promise<string> {
  const runId = randomUUID();
  await insertRun(world.db, {
    id: runId,
    measurePageId: world.measureId,
    measureVersion: 1,
    toolHash: await toolHashOf(scoredMeasure),
    kind: run.kind,
    requestedBy: world.admin.identity,
    lock: PINNED_LOCK,
    lockSha256: '0'.repeat(64),
    area: MEASURE_AREA,
    createdAt: run.at,
  });
  for (const [resourcePageId, observed] of outcomes) {
    await recordObservation(world.db, {
      runId,
      measurePageId: world.measureId,
      measureVersion: 1,
      resourcePageId,
      observedAt: run.at,
      toolVersion: run.toolVersion ?? '4.19.10',
      ...valuesOf(observed),
      raw: null,
      area: MEASURE_AREA,
    });
  }
  await finishRun(world.db, runId, 'ok', run.at);
  return runId;
}

export function day(n: number): Date {
  return new Date(Date.UTC(2026, 10, n, 6));
}

export async function savedDashboard(
  world: ReadWorld,
  context: Parameters<typeof saveDashboard>[1]['context'],
  panels: readonly Panel[],
): Promise<string> {
  const dashboardId = randomUUID();
  const request = {
    db: world.db,
    actor: agentOf(world.admin),
    traceId: randomUUID(),
    at: collectionsAt,
  };
  const made = await saveDashboard(request, {
    dashboardId,
    expectedVersion: null,
    jdArea: MEASURE_AREA,
    title: `Website findability ${dashboardId.slice(0, 8)}`,
    slug: `website-findability-${dashboardId.slice(0, 8)}`,
    intro: 'How findable each website we maintain is.',
    context,
    panels: [...panels],
  });
  if (!made.ok) throw new Error(`dashboard refused: ${made.reason}`);
  return dashboardId;
}

export async function covertlyServedProject(world: ReadWorld): Promise<string> {
  const { db, wide } = world;
  const project = await rowIn(db, wide, {
    collection: 'project',
    jdArea: MEASURE_AREA,
    title: 'Partner website',
  });
  const served = (title: string, address: string, jdArea: string) =>
    rowIn(db, wide, {
      collection: 'resource',
      jdArea,
      title,
      values: { kind: 'website', address, serves_project: [project] },
    });
  await served('Unmeasured site', 'https://unmeasured.example.org/', MEASURE_AREA);
  const covert = await served('Covert site', 'https://covert.example.org/', PROGRAM_AREA);
  await observe(world, { kind: 'scheduled', at: day(4) }, new Map([[covert, { score: 40 }]]));
  return project;
}

export async function rewriteBody(world: ReadWorld, pageId: string, bodyMd: string): Promise<void> {
  const page = await readPage(world.db, world.wide, pageId, collectionsAt);
  if (page === null) throw new Error('no page to rewrite');
  const command = {
    command: 'update_page' as const,
    requestId: randomUUID(),
    pageId,
    expectedVersion: page.version,
    title: page.title,
    slug: page.slug,
    frontmatter: page.frontmatter,
    bodyMd,
    parentId: page.parentId,
    status: page.status,
  };
  const saved = await updatePage(world.db, world.wide, command, randomUUID(), collectionsAt);
  if (!saved.ok) throw new Error(`rewrite refused: ${saved.reason}`);
}
