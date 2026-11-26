import type { Principal } from '@uw/core/principal';
import type { Executor } from '@uw/db/client';
import { activationFor, pauseActivation } from './activations.ts';
import { administers, personActing, personIdOf } from './authority.ts';
import { measurePageOf, type MeasurePage } from './measure-pages.ts';
import type { RunRecord } from './runs.ts';
import { toolHashOf } from './tool.ts';

export type RunAuthority =
  | {
      readonly ok: true;
      readonly actor: Principal;
      readonly measure: MeasurePage;
      readonly lock: string | null;
    }
  | { readonly ok: false };

const stopped: RunAuthority = { ok: false };

async function adminActing(
  db: Executor,
  personId: string | null,
  area: string,
  at: Date,
): Promise<Principal | null> {
  if (personId === null) return null;
  const actor = await personActing(db, personId, at);
  return actor !== null && administers(actor, area, at) ? actor : null;
}

async function trialAuthority(
  db: Executor,
  run: RunRecord,
  measure: MeasurePage,
  at: Date,
): Promise<RunAuthority> {
  if (measure.status === 'retired') return stopped;
  if ((await toolHashOf(measure.measure)) !== run.toolHash) return stopped;
  const actor = await adminActing(db, personIdOf(run.requestedBy), measure.jdArea, at);
  return actor === null ? stopped : { ok: true, actor, measure, lock: run.lock };
}

async function activeAuthority(
  db: Executor,
  run: RunRecord,
  measure: MeasurePage,
  at: Date,
): Promise<RunAuthority> {
  const activation = await activationFor(db, measure.id);
  if (activation === null || activation.pausedReason !== null) return stopped;
  if (run.toolHash !== activation.toolHash || run.lock !== activation.lock) return stopped;
  if (measure.status === 'retired') {
    await pauseActivation(db, measure.id, 'retired');
    return stopped;
  }
  if (measure.status !== 'active' || measure.version !== activation.version) {
    await pauseActivation(db, measure.id, 'changed');
    return stopped;
  }
  const actor = await adminActing(db, activation.activatorPersonId, measure.jdArea, at);
  if (actor === null) {
    await pauseActivation(db, measure.id, 'activator_lost_access');
    return stopped;
  }
  return { ok: true, actor, measure, lock: activation.lock };
}

export async function authorityOfRun(
  db: Executor,
  run: RunRecord,
  at: Date,
): Promise<RunAuthority> {
  const measure = await measurePageOf(db, run.measurePageId);
  if (measure === null) return stopped;
  if (run.kind === 'trial') return trialAuthority(db, run, measure, at);
  return activeAuthority(db, run, measure, at);
}
