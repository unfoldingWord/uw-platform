import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import { collectionsAt, rowIn } from '../testing/collections.ts';
import {
  day,
  observe,
  readWorld,
  savedDashboard,
  scoredMeasure,
  type ReadWorld,
} from '../testing/measure-reads.ts';
import { agentOf, forceActive, MEASURE_AREA } from '../testing/measure-world.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { activateDashboard } from './activation.ts';
import { saveMeasure } from './authoring.ts';
import { dashboardPageOf } from './measure-pages.ts';
import { reportCardsFor } from './report-cards.ts';

async function directCard(world: ReadWorld): Promise<string> {
  const panels = [{ kind: 'figure', measure: world.measureId, metric: 'latest_score' }] as const;
  const cardId = await savedDashboard(world, { kind: 'host', descendants: false }, panels);
  const request = { db: world.db, actor: agentOf(world.admin), traceId: randomUUID() };
  const saved = await saveMeasure(
    { ...request, at: collectionsAt },
    {
      measureId: world.measureId,
      expectedVersion: 1,
      jdArea: MEASURE_AREA,
      title: 'GEO score of our websites',
      slug: 'geo-score',
      bodyMd: 'How findable our websites are.',
      measure: { ...scoredMeasure, report_card: cardId },
    },
  );
  if (!saved.ok) throw new Error(saved.reason);
  await forceActive(world, world.measureId);
  const card = await dashboardPageOf(world.db, cardId);
  const command = {
    command: 'activate_dashboard' as const,
    requestId: randomUUID(),
    dashboardId: cardId,
    expectedVersion: card?.version ?? 0,
  };
  const context = { traceId: randomUUID(), at: collectionsAt };
  const activated = await activateDashboard(world.db, world.admin, command, context);
  if (!activated.ok) throw new Error(`dashboard refused: ${activated.reason}`);
  return cardId;
}

async function needsMeasuredResourceInItsOwnContext(db: Database): Promise<void> {
  const world = await readWorld(db);
  await observe(
    world,
    { kind: 'scheduled', at: day(1) },
    new Map([[world.sites.uw, { score: 80 }]]),
  );
  await rowIn(db, world.wide, {
    collection: 'resource',
    jdArea: MEASURE_AREA,
    title: 'Program app',
    values: {
      kind: 'mobile_app',
      address: 'https://app.example.org/',
      serves_program: [world.program],
    },
  });
  const cardId = await directCard(world);
  const reader = { db, actor: world.admin, at: collectionsAt };
  expect(await reportCardsFor(reader, world.program)).toEqual([]);
  const onProject = await reportCardsFor(reader, world.project);
  expect(onProject.map((card) => card.dashboard.id)).toEqual([cardId]);
}

describe.skipIf(!testServer)('ADR 0036 a report card shows where its measure observed', () => {
  it('needs a resource the measure observed in the card context, not any resource there', () =>
    withAppDatabase(needsMeasuredResourceInItsOwnContext));
});
