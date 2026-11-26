import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import { memoryFiles, type FileStore } from '../pages/file-store.ts';
import { sha256Hex } from '../pdf/provenance.ts';
import { collectionsAt, rowIn } from '../testing/collections.ts';
import { readWorld, scoredMeasure, type ReadWorld } from '../testing/measure-reads.ts';
import { MEASURE_AREA, PINNED_LOCK } from '../testing/measure-world.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { recordObservation } from './observation-records.ts';
import { measureRunFor } from './run-reads.ts';
import { rawKeyOf } from './run-steps.ts';
import { finishRun, insertRun } from './runs.ts';
import { toolHashOf } from './tool.ts';

const SITES = 5;
const DETAILED = 3;

function countingFiles(files: FileStore): FileStore & { readonly gets: string[] } {
  const gets: string[] = [];
  return {
    gets,
    put: (key, file) => files.put(key, file),
    remove: (key) => files.remove(key),
    get: (key) => {
      gets.push(key);
      return files.get(key);
    },
  };
}

async function sitesOf(world: ReadWorld): Promise<string[]> {
  const made: string[] = [];
  for (let n = 0; n < SITES; n += 1) {
    made.push(
      await rowIn(world.db, world.wide, {
        collection: 'resource',
        jdArea: MEASURE_AREA,
        title: `Site ${String(n)}`,
        values: { kind: 'website', address: `https://site${String(n)}.example.org/` },
      }),
    );
  }
  return made;
}

async function runWithRaw(world: ReadWorld, files: FileStore, sites: readonly string[]) {
  const runId = randomUUID();
  await insertRun(world.db, {
    id: runId,
    measurePageId: world.measureId,
    measureVersion: 1,
    toolHash: await toolHashOf(scoredMeasure),
    kind: 'scheduled',
    requestedBy: world.admin.identity,
    lock: PINNED_LOCK,
    lockSha256: await sha256Hex(PINNED_LOCK),
    area: MEASURE_AREA,
    createdAt: collectionsAt,
  });
  for (const [n, site] of sites.entries()) {
    const text = JSON.stringify({
      score: n,
      band: 'good',
      recommendations: [],
      pad: 'x'.repeat(n),
    });
    const bytes = new TextEncoder().encode(text);
    const key = rawKeyOf(runId, site);
    await files.put(key, { bytes, contentType: 'text/plain; charset=utf-8' });
    await recordObservation(world.db, {
      runId,
      measurePageId: world.measureId,
      measureVersion: 1,
      resourcePageId: site,
      observedAt: collectionsAt,
      toolVersion: '4.19.10',
      values: { score: n, band: 'good', fixes: [] },
      reason: null,
      raw: { key, sha256: await sha256Hex(bytes), length: text.length },
      area: MEASURE_AREA,
    });
  }
  await finishRun(world.db, runId, 'ok', collectionsAt);
  return runId;
}

async function readsRawOnlyForDetailedRows(db: Database): Promise<void> {
  const world = await readWorld(db);
  const files = countingFiles(memoryFiles());
  const sites = await sitesOf(world);
  const runId = await runWithRaw(world, files, sites);
  const read = { measureId: world.measureId, runId, resourceId: null };
  const reply = await measureRunFor(db, world.admin, read, { files, at: collectionsAt });
  expect(reply?.detailLimited).toBe(true);
  expect(files.gets).toHaveLength(DETAILED);
  const observations = reply?.observations ?? [];
  expect(observations).toHaveLength(SITES);
  for (const observation of observations.slice(DETAILED)) {
    expect(observation.raw).toBeNull();
    const n = Number(observation.title.replace('Site ', ''));
    const text = JSON.stringify({
      score: n,
      band: 'good',
      recommendations: [],
      pad: 'x'.repeat(n),
    });
    expect(observation.rawLength).toBe(text.length);
  }
}

describe.skipIf(!testServer)('ADR 0036 a run read fetches raw output only for its detail', () => {
  it('reads the raw length from the observation and fetches only the detailed rows', () =>
    withAppDatabase(readsRawOnlyForDetailedRows));
});
