import type { MeasureRunCommand } from '@uw/contracts';
import type { Principal } from '@uw/core/principal';
import type { Database, Transaction } from '@uw/db/client';
import { administers, freshPerson } from './authority.ts';
import { launched, refused, type Launched, type Queued, type RunStarter } from './launch.ts';
import { readableMeasure } from './measure-pages.ts';
import { insertRun, openTrialOf } from './runs.ts';
import { toolHashOf } from './tool.ts';

async function queueTrial(
  tx: Transaction,
  actor: Principal,
  command: MeasureRunCommand,
  at: Date,
): Promise<Queued> {
  const fresh = await freshPerson(tx, actor, at);
  if (fresh === null) return refused('not_permitted');
  const measure = await readableMeasure(tx, fresh, command.measureId, at);
  if (measure === null) return refused('page_not_found');
  if (!administers(fresh, measure.jdArea, at)) return refused('not_permitted');
  if (measure.version !== command.expectedVersion) return refused('stale_version');
  if (measure.status !== 'suggested') return refused('not_permitted');
  const toolHash = await toolHashOf(measure.measure);
  if (await openTrialOf(tx, measure.id, toolHash, at)) return refused('request_in_flight');
  const runId = crypto.randomUUID();
  await insertRun(tx, {
    id: runId,
    measurePageId: measure.id,
    measureVersion: measure.version,
    toolHash,
    kind: 'trial',
    requestedBy: fresh.identity,
    lock: null,
    lockSha256: null,
    area: measure.jdArea,
    createdAt: at,
  });
  return { ok: true, runId };
}

export async function startTrial(
  db: Database,
  actor: Principal,
  command: MeasureRunCommand,
  starter: RunStarter,
  at: Date,
): Promise<Launched> {
  if (actor.kind !== 'person') return refused('not_permitted');
  if (starter.binding === null) return refused('not_wired');
  const queued = await db.transaction((tx) => queueTrial(tx, actor, command, at));
  return launched(db, starter, queued, at);
}
