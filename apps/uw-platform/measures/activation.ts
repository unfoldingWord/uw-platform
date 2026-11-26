import type { ActivateDashboardCommand, ActivateMeasureCommand, ErrorReason } from '@uw/contracts';
import type { Principal } from '@uw/core/principal';
import type { Database, Transaction } from '@uw/db/client';
import type { FileStore } from '../pages/file-store.ts';
import { flipGatedPageIn } from '../pages/gated-flip.ts';
import { activatable, activationFor, lockedActivation, saveActivation } from './activations.ts';
import { administers, freshPerson } from './authority.ts';
import { refused, type Refused } from './launch.ts';
import {
  dashboardPageOf,
  measurePageOf,
  readableMeasure,
  type MeasurePage,
} from './measure-pages.ts';
import { toolHashOf } from './tool.ts';
import { readsCleanly, sourceRunFor, type SourceRun } from './trial-reads.ts';

export type Activated = { readonly ok: true } | Refused;

type Context = { readonly traceId: string; readonly at: Date };
type MeasureContext = Context & { readonly files: FileStore | null };

type Plan = {
  readonly command: ActivateMeasureCommand;
  readonly measure: MeasurePage;
  readonly toolHash: string;
  readonly source: SourceRun;
};

class ActivationRefused extends Error {
  constructor(readonly reason: ErrorReason) {
    super(reason);
  }
}

async function freshAdmin(tx: Transaction, actor: Principal, area: string, at: Date) {
  const fresh = await freshPerson(tx, actor, at);
  if (fresh === null || !administers(fresh, area, at)) {
    throw new ActivationRefused('not_permitted');
  }
  return fresh;
}

async function flipDashboard(tx: Transaction, actor: Principal, id: string, context: Context) {
  const dashboard = await dashboardPageOf(tx, id);
  if (dashboard === null) throw new ActivationRefused('page_not_found');
  const flip = { pageId: id, type: 'dashboard' as const, expectedVersion: dashboard.version };
  const flipped = await flipGatedPageIn(tx, actor, flip, { ...context, requestId: null });
  if (!flipped.ok) throw new ActivationRefused(flipped.reason);
}

async function activeVersionIn(
  tx: Transaction,
  fresh: Principal,
  plan: Plan,
  context: Context,
): Promise<number> {
  const { command, measure } = plan;
  if (measure.status === 'suggested') {
    const flip = {
      pageId: measure.id,
      type: 'measure' as const,
      expectedVersion: command.expectedVersion,
    };
    const at = { ...context, requestId: command.requestId };
    const flipped = await flipGatedPageIn(tx, fresh, flip, at);
    if (!flipped.ok) throw new ActivationRefused(flipped.reason);
    return flipped.page.version;
  }
  const activation = await lockedActivation(tx, measure.id);
  const current = await measurePageOf(tx, measure.id);
  if (current === null || current.version !== command.expectedVersion) {
    throw new ActivationRefused('stale_version');
  }
  if (!activatable(current.status, activation)) throw new ActivationRefused('not_permitted');
  return current.version;
}

async function activateIn(tx: Transaction, actor: Principal, plan: Plan, context: Context) {
  const { command, measure, toolHash, source } = plan;
  const fresh = await freshAdmin(tx, actor, measure.jdArea, context.at);
  const version = await activeVersionIn(tx, fresh, plan, context);
  await saveActivation(tx, {
    measurePageId: measure.id,
    version,
    toolHash,
    lock: source.lock,
    lockSha256: source.lockSha256,
    activatorPersonId: fresh.personId ?? '',
    area: measure.jdArea,
    activatedAt: context.at,
    nextRunAt: context.at,
    pausedReason: null,
  });
  for (const id of command.dashboards) await flipDashboard(tx, fresh, id, context);
}

async function planFor(
  db: Database,
  actor: Principal,
  command: ActivateMeasureCommand,
  context: MeasureContext,
): Promise<Plan | Refused> {
  const measure = await readableMeasure(db, actor, command.measureId, context.at);
  if (measure === null) return refused('page_not_found');
  if (!administers(actor, measure.jdArea, context.at)) return refused('not_permitted');
  if (measure.version !== command.expectedVersion) return refused('stale_version');
  if (!activatable(measure.status, await activationFor(db, measure.id))) {
    return refused('not_permitted');
  }
  if (context.files === null) return refused('not_wired');
  const toolHash = await toolHashOf(measure.measure);
  const source = await sourceRunFor(db, measure.id, toolHash);
  if (source === null) return refused('trial_required');
  const reader = { actor, at: context.at };
  const read = await readsCleanly(db, context.files, source.runId, { ...measure.measure, reader });
  if (read === 'none_readable') return refused('trial_required');
  if (read === 'unreadable') return refused('trial_unreadable');
  return { command, measure, toolHash, source };
}

async function settled(work: () => Promise<void>): Promise<Activated> {
  try {
    await work();
    return { ok: true };
  } catch (error) {
    if (error instanceof ActivationRefused) return refused(error.reason);
    throw error;
  }
}

export async function activateMeasure(
  db: Database,
  actor: Principal,
  command: ActivateMeasureCommand,
  context: MeasureContext,
): Promise<Activated> {
  if (actor.kind !== 'person') return refused('not_permitted');
  const plan = await planFor(db, actor, command, context);
  if ('ok' in plan) return plan;
  return settled(() => db.transaction((tx) => activateIn(tx, actor, plan, context)));
}

export async function activateDashboard(
  db: Database,
  actor: Principal,
  command: ActivateDashboardCommand,
  context: Context,
): Promise<Activated> {
  if (actor.kind !== 'person') return refused('not_permitted');
  const flip = {
    pageId: command.dashboardId,
    type: 'dashboard' as const,
    expectedVersion: command.expectedVersion,
  };
  const source = { ...context, requestId: command.requestId };
  return settled(() =>
    db.transaction(async (tx) => {
      const fresh = await freshPerson(tx, actor, context.at);
      if (fresh === null) throw new ActivationRefused('not_permitted');
      const flipped = await flipGatedPageIn(tx, fresh, flip, source);
      if (!flipped.ok) throw new ActivationRefused(flipped.reason);
    }),
  );
}
