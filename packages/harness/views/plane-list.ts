import type { HarnessEvent } from '@uw/contracts';
import { can } from '@uw/core/acl';
import { formatDate, formatInstant, isoDateSchema, parseDate } from '@uw/core/dates';
import { formatMoney } from '@uw/core/money';
import type { Caller } from '../caller.ts';
import type { PageFacts, RunRow, StoreTransaction } from '../ports.ts';
import { readableHarness, type ScenePorts } from '../reads/scene.ts';
import {
  agentWrite,
  dayBefore,
  dayStart,
  monthStart,
  refusalNames,
  refusalReasons,
  weekBefore,
} from './plane.ts';
import { PLANE_LIMIT, type PlaneIndicator, type PlaneRow } from './types.ts';

const LEARNING_REVIEW_MS = 90 * 24 * 3_600_000;

type ListScope = {
  readonly ports: ScenePorts;
  readonly tx: StoreTransaction;
  readonly caller: Caller;
  readonly at: Date;
};

function tokensOf(run: RunRow): number {
  return run.steps.reduce((sum, step) => sum + step.tokensIn + step.tokensOut, 0);
}

function costCell(run: RunRow): string | null {
  if (run.costBasis === 'subscription') return null;
  const amountMinor = (run.costMinor ?? 0) + (run.computeMinor ?? 0);
  return formatMoney({ amountMinor, currency: 'USD' });
}

function runRow(run: RunRow): PlaneRow {
  return {
    harnessId: run.harnessId,
    cells: {
      run: run.id,
      persona: run.persona,
      engine: run.engine,
      shape: run.runShape,
      model: run.model,
      started: formatInstant(run.startedAt),
      cost: costCell(run),
      tokens: tokensOf(run),
    },
  };
}

async function runRows(scope: ListScope, since: Date): Promise<readonly PlaneRow[]> {
  return (await scope.tx.harnessRuns.read.startedSince(since, PLANE_LIMIT)).map(runRow);
}

async function delegationRows(scope: ListScope): Promise<readonly PlaneRow[]> {
  const filter = { personId: null, persona: null, harnessId: null };
  const live = await scope.tx.delegations.read.live(filter, scope.at);
  return live.map((delegation) => ({
    harnessId: delegation.harnessId,
    cells: {
      persona: delegation.persona,
      person: delegation.personId,
      capability: delegation.capability,
      expires: formatInstant(delegation.expiresAt),
    },
  }));
}

function eventAt(event: HarnessEvent): string {
  return formatInstant(new Date(event.at));
}

async function refusalRows(scope: ListScope): Promise<readonly PlaneRow[]> {
  const events = await scope.tx.harnessEvents.read.recent({
    since: weekBefore(scope.at),
    names: refusalNames,
    agentsOnly: false,
    limit: PLANE_LIMIT,
  });
  return events.flatMap((event) =>
    refusalReasons(event).map((reason) => ({
      harnessId: event.harnessId,
      cells: { reason, item: event.itemId, at: eventAt(event) },
    })),
  );
}

async function writeRows(scope: ListScope): Promise<readonly PlaneRow[]> {
  const events = await scope.tx.harnessEvents.read.recent({
    since: dayBefore(scope.at),
    names: null,
    agentsOnly: true,
    limit: PLANE_LIMIT,
  });
  return events.filter(agentWrite).map((event) => ({
    harnessId: event.harnessId,
    cells: { actor: event.actor, event: event.name, at: eventAt(event) },
  }));
}

function reviewBy(page: PageFacts): string | null {
  const due = isoDateSchema.safeParse(page.frontmatter['review_by']);
  if (due.success) return due.data;
  const from = isoDateSchema.safeParse(page.frontmatter['as_of']);
  if (!from.success) return null;
  return formatDate(new Date(parseDate(from.data).getTime() + LEARNING_REVIEW_MS));
}

function confidenceOf(page: PageFacts): string | null {
  const confidence = page.frontmatter['confidence'];
  return typeof confidence === 'string' ? confidence : null;
}

async function learningRows(scope: ListScope): Promise<readonly PlaneRow[]> {
  const pages = await scope.tx.pages.read.staleLearnings(formatDate(scope.at), PLANE_LIMIT);
  const { actor } = scope.caller;
  return pages
    .filter((page) => can(actor, 'read', { kind: 'area', area: page.jdArea }, scope.at))
    .map((page) => ({
      harnessId: null,
      cells: { title: page.title, confidence: confidenceOf(page), 'review by': reviewBy(page) },
    }));
}

type Reader = (scope: ListScope) => Promise<readonly PlaneRow[]>;

const readers: ReadonlyMap<PlaneIndicator, Reader> = new Map<PlaneIndicator, Reader>([
  ['spend', (scope) => runRows(scope, monthStart(scope.at))],
  ['runs_today', (scope) => runRows(scope, dayStart(scope.at))],
  ['live_delegations', delegationRows],
  ['gate_refusals_week', refusalRows],
  ['agent_writes', writeRows],
  ['stale_learnings', learningRows],
]);

async function readableIds(
  scope: ListScope,
  rows: readonly PlaneRow[],
): Promise<ReadonlySet<string>> {
  const ids = new Set(rows.flatMap((row) => (row.harnessId === null ? [] : [row.harnessId])));
  const readable = new Set<string>();
  for (const id of ids) {
    const harness = await readableHarness(scope.ports, scope.tx, scope.caller, id, scope.at);
    if (harness !== null) readable.add(id);
  }
  return readable;
}

export async function planeList(
  scope: ListScope,
  indicator: PlaneIndicator,
): Promise<readonly PlaneRow[]> {
  const reader = readers.get(indicator);
  const rows = reader === undefined ? [] : await reader(scope);
  const readable = await readableIds(scope, rows);
  return rows.filter((row) => row.harnessId === null || readable.has(row.harnessId));
}
