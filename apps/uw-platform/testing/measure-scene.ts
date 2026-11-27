import { WEBSITES_VIEW_ID } from '@uw/contracts';
import type { Database } from '@uw/db/client';
import { bucketFiles } from '../pages/file-store.ts';
import { memoryBucket } from './files.ts';
import { measureApp, type MeasureApp } from './measure-app.ts';
import {
  fakeMeasureSandbox,
  geoMeasure,
  geoOutput,
  inlineMeasureRuns,
  MEASURE_AREA,
  measureWorld,
  newId,
  type FakeOutput,
  type MeasureWorld,
} from './measure-world.ts';

export const sites = [
  ['unfoldingWord', 'https://www.unfoldingword.org/', 81],
  ['Door43', 'https://door43.org/', 64],
  ['translationCore', 'https://translationcore.com/', 92],
] as const;

export type Scene = {
  readonly world: MeasureWorld;
  readonly app: MeasureApp;
  readonly email: string;
};

export async function scene(
  db: Database,
  outputOf: (address: string, score: number) => FakeOutput = (_address, score) => geoOutput(score),
): Promise<Scene> {
  const world = await measureWorld(db);
  const bucket = memoryBucket();
  const outputs = new Map(
    sites.map(([, address, score]) => [new URL(address).host, outputOf(address, score)]),
  );
  const sandbox = fakeMeasureSandbox(outputs);
  const files = bucketFiles(bucket);
  const runs = inlineMeasureRuns({ db, files, sandbox, now: () => new Date() });
  return {
    world,
    app: measureApp(db, { FILES: bucket, MEASURE_RUN: runs }),
    email: world.admin.email ?? '',
  };
}

export async function accepted(scene: Scene, name: string, args: Record<string, unknown>) {
  const called = await scene.app.verb(scene.email, name, args);
  if (called.isError) throw new Error(`${name} refused: ${JSON.stringify(called.body)}`);
  return called.body;
}

export async function addSites(scene: Scene): Promise<string[]> {
  const ids: string[] = [];
  for (const [title, address] of sites) {
    const rowId = newId();
    await accepted(scene, 'create_row', {
      collection: 'resource',
      rowId,
      jdArea: MEASURE_AREA,
      title,
      values: { kind: 'website', address },
    });
    ids.push(rowId);
  }
  return ids;
}

export function measureArgs(
  measureId: string,
  expectedVersion: number | null,
  measure = geoMeasure(),
) {
  return {
    measureId,
    expectedVersion,
    jdArea: MEASURE_AREA,
    title: 'SEO and GEO score of our websites',
    slug: 'seo-geo-score',
    bodyMd: 'The GEO audit of every website we maintain.',
    measure: { ...measure, resources: { view: WEBSITES_VIEW_ID } },
  };
}
