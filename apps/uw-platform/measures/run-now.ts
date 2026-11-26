import { can } from '@uw/core/acl';
import type { Principal } from '@uw/core/principal';
import type { Database, Transaction } from '@uw/db/client';
import { lockedActivation } from './activations.ts';
import {
  HOUR_MS,
  launched,
  refused,
  type Launched,
  type Queued,
  type RunStarter,
} from './launch.ts';
import { readableMeasure, type MeasurePage } from './measure-pages.ts';
import { insertRun, requestedSince } from './runs.ts';

export type RunAsked = { readonly measureId: string; readonly expectedVersion: number | null };

type Asking = { readonly actor: Principal; readonly wired: boolean; readonly at: Date };

async function queueRequested(
  tx: Transaction,
  measure: MeasurePage,
  { actor, wired, at }: Asking,
): Promise<Queued> {
  const activation = await lockedActivation(tx, measure.id);
  if (activation === null) return refused('not_permitted');
  const current = measure.status === 'active' && activation.version === measure.version;
  if (activation.pausedReason !== null || !current) return refused('measure_paused');
  if (await requestedSince(tx, measure.id, new Date(at.getTime() - HOUR_MS))) {
    return refused('run_too_soon');
  }
  if (!wired) return refused('not_wired');
  const runId = crypto.randomUUID();
  await insertRun(tx, {
    id: runId,
    measurePageId: measure.id,
    measureVersion: measure.version,
    toolHash: activation.toolHash,
    kind: 'requested',
    requestedBy: actor.identity,
    lock: activation.lock,
    lockSha256: activation.lockSha256,
    area: measure.jdArea,
    createdAt: at,
  });
  return { ok: true, runId };
}

export async function requestRun(
  db: Database,
  actor: Principal,
  asked: RunAsked,
  starter: RunStarter,
  at: Date,
): Promise<Launched> {
  const measure = await readableMeasure(db, actor, asked.measureId, at);
  if (measure === null) return refused('page_not_found');
  if (!can(actor, 'write', { kind: 'area', area: measure.jdArea }, at)) {
    return refused('not_permitted');
  }
  if (asked.expectedVersion !== null && asked.expectedVersion !== measure.version) {
    return refused('stale_version');
  }
  const asking = { actor, wired: starter.binding !== null, at };
  const queued = await db.transaction((tx) => queueRequested(tx, measure, asking));
  return launched(db, starter, queued, at);
}
