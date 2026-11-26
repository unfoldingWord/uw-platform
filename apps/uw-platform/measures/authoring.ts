import type { z } from 'zod';
import type { AuthoringProblem, MeasureAwaiting, PageStatus, Page, verbIo } from '@uw/contracts';
import type { Principal } from '@uw/core/principal';
import type { Database, Executor } from '@uw/db/client';
import { ensureBuiltIns } from '../collections/builtins/seed.ts';
import { saveGatedPageAsAgent } from '../pages/gated-save.ts';
import type { FileStore } from '../pages/file-store.ts';
import type { PageRefusal, PageResult } from '../pages/store.ts';
import { activationFor, pauseActivation } from './activations.ts';
import { dashboardBody } from './panel-blocks.ts';
import { dashboardProblems, measureProblems } from './problems.ts';
import { usableTrialOf } from './runs.ts';
import { toolHashOf } from './tool.ts';
import { trialValueProblems } from './value-checks.ts';

const MOST_PROBLEMS = 100;

type MeasureInput = z.infer<(typeof verbIo)['save_measure']['input']>;
type DashboardInput = z.infer<(typeof verbIo)['save_dashboard']['input']>;

export type AuthoringRequest = {
  readonly db: Database;
  readonly actor: Principal;
  readonly traceId: string;
  readonly at: Date;
  readonly files?: FileStore | null;
};

export type Authored<T> = { readonly ok: true; readonly value: T } | PageRefusal;

export type SavedMeasure = {
  readonly measureId: string;
  readonly version: number;
  readonly status: PageStatus;
  readonly toolHash: string;
  readonly awaiting: MeasureAwaiting;
  readonly problems: readonly AuthoringProblem[];
};

export type SavedDashboard = {
  readonly dashboardId: string;
  readonly version: number;
  readonly status: PageStatus;
  readonly problems: readonly AuthoringProblem[];
};

function refusalOf(result: Extract<PageResult | PageRefusal, { ok: false }>): PageRefusal {
  return { ok: false, reason: result.reason, detail: 'detail' in result ? result.detail : {} };
}

export async function awaitingOf(
  db: Executor,
  page: Pick<Page, 'id' | 'status' | 'version'>,
  toolHash: string,
): Promise<MeasureAwaiting> {
  const activation = await activationFor(db, page.id);
  const live = activation !== null && activation.pausedReason === null;
  if (live && page.status === 'active' && activation.version === page.version) return 'nothing';
  if (activation?.toolHash === toolHash) return 'activation';
  return (await usableTrialOf(db, page.id, toolHash)) === null ? 'trial' : 'activation';
}

function checkerOf(request: AuthoringRequest) {
  const { db, actor, at } = request;
  return { db, actor, at, files: request.files ?? null };
}

export async function saveMeasure(
  request: AuthoringRequest,
  input: MeasureInput,
): Promise<Authored<SavedMeasure>> {
  const { db, actor, traceId, at } = request;
  await ensureBuiltIns(db, at);
  const problems = [
    ...(await measureProblems({ db, actor, at }, input.measure)),
    ...(await trialValueProblems(checkerOf(request), input.measureId, input.measure)),
  ].slice(0, MOST_PROBLEMS);
  const save = {
    pageId: input.measureId,
    type: 'measure' as const,
    expectedVersion: input.expectedVersion,
    jdArea: input.jdArea,
    title: input.title,
    slug: input.slug,
    frontmatter: input.measure,
    bodyMd: input.bodyMd,
  };
  const saved = await saveGatedPageAsAgent(db, actor, save, { traceId, at });
  if (!saved.ok) return refusalOf(saved);
  if (input.expectedVersion !== null) await pauseActivation(db, input.measureId, 'changed');
  const toolHash = await toolHashOf(input.measure);
  const { page } = saved;
  const awaiting = await awaitingOf(db, page, toolHash);
  const value = { measureId: page.id, version: page.version, status: page.status };
  return { ok: true, value: { ...value, toolHash, awaiting, problems } };
}

export async function saveDashboard(
  request: AuthoringRequest,
  input: DashboardInput,
): Promise<Authored<SavedDashboard>> {
  const { db, actor, traceId, at } = request;
  const problems = await dashboardProblems({ db, actor, at }, input);
  const save = {
    pageId: input.dashboardId,
    type: 'dashboard' as const,
    expectedVersion: input.expectedVersion,
    jdArea: input.jdArea,
    title: input.title,
    slug: input.slug,
    frontmatter: { context: input.context },
    bodyMd: dashboardBody(input.intro, input.panels),
  };
  const saved = await saveGatedPageAsAgent(db, actor, save, { traceId, at });
  if (!saved.ok) return refusalOf(saved);
  const { page } = saved;
  const value = { dashboardId: page.id, version: page.version, status: page.status };
  return { ok: true, value: { ...value, problems } };
}
