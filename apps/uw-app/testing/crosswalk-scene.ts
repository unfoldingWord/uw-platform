import { randomUUID } from 'node:crypto';
import type { Clock } from '@uw/harness';
import type { Database } from '@uw/db/client';
import { ensureBuiltIns } from '../collections/builtins/seed.ts';
import { declareJdMap } from '../crosswalk/map.ts';
import { placeInCascade } from '../crosswalk/placements.ts';
import { personWith, rowIn } from './collections.ts';
import { withAppDatabase } from './postgres.ts';
import { getHtml } from './views.ts';

type CrosswalkScene = { readonly email: string; readonly program: string };

async function crosswalkScene(db: Database, at: Date): Promise<CrosswalkScene> {
  await ensureBuiltIns(db, at);
  const admin = await personWith(db, 'crosswalk.admin', [{ role: 'admin', area: null }]);
  const portfolio = await rowIn(db, admin, {
    collection: 'portfolio',
    jdArea: '00-09',
    title: 'Church-centric Bible translation',
  });
  const program = await rowIn(db, admin, {
    collection: 'program',
    jdArea: '60-69',
    title: 'Gateway languages',
    values: { portfolio },
  });
  const project = await rowIn(db, admin, {
    collection: 'project',
    jdArea: '60-69',
    title: 'Nairobi workshop',
    values: { program },
  });
  const task = await rowIn(db, admin, {
    collection: 'tasks',
    jdArea: '20-29',
    title: 'Reconcile the workshop costs',
  });
  const declared = [
    ['20-29', portfolio, 'supports'],
    ['40-49', portfolio, 'funds'],
    ['60-69', program, 'owns'],
  ] as const;
  for (const [jdArea, cascadePageId, relation] of declared) {
    const command = { command: 'declare_jd_map', requestId: randomUUID(), note: null } as const;
    await declareJdMap(
      db,
      admin,
      { ...command, jdArea, cascadePageId, relation },
      randomUUID(),
      at,
    );
  }
  const placing = { command: 'place_in_cascade', requestId: randomUUID() } as const;
  const placed = { entityKind: 'task', entityId: task, cascadePageId: project } as const;
  await placeInCascade(db, admin, { ...placing, ...placed }, at);
  return { email: admin.email ?? '', program };
}

type Shot = { readonly name: string; readonly html: string };

export const crosswalkNames = ['crosswalk', 'crosswalk-cell', 'crosswalk-node'] as const;

async function shotsIn(db: Database, at: Date, clock: Clock): Promise<Shot[]> {
  const scene = await crosswalkScene(db, at);
  const paths = new Map<string, string>([
    ['crosswalk', '/crosswalk'],
    ['crosswalk-cell', '/crosswalk/areas/60-69/program'],
    ['crosswalk-node', `/crosswalk/nodes/${scene.program}`],
  ]);
  const taken: Shot[] = [];
  for (const name of crosswalkNames) {
    const page = await getHtml(db, scene.email, paths.get(name) ?? '/crosswalk', {}, clock);
    taken.push({ name, html: page.text });
  }
  return taken;
}

export async function crosswalkShots(at: Date, clock: Clock): Promise<Shot[]> {
  let taken: Shot[] = [];
  await withAppDatabase(async (db) => {
    taken = await shotsIn(db, at, clock);
  });
  return taken;
}
