import type { HarnessEvent } from '@uw/contracts';
import { can } from '@uw/core/acl';
import {
  formatDate,
  formatDuration,
  formatInstant,
  isoDateSchema,
  parseDate,
} from '@uw/core/dates';
import { formatMoney } from '@uw/core/money';
import type { Caller } from '../caller.ts';
import { silences } from '../alarms/silence.ts';
import type { PageFacts, Ports, RunRow, StoreTransaction } from '../ports.ts';
import { readableHarness } from '../reads/scene.ts';
import { holdsOf } from './holds.ts';
import {
  agentWrite,
  dayBefore,
  dayStart,
  monthStart,
  refusalNames,
  refusalReasons,
  weekBefore,
} from './plane.ts';
import { refuteNames, refuteSince, refuteTallies, type RefuteTally } from './refutes.ts';
import { PLANE_LIMIT, type PlaneIndicator, type PlaneRow } from './types.ts';

const LEARNING_REVIEW_MS = 90 * 24 * 3_600_000;

type ListScope = {
  readonly ports: Pick<Ports, 'grants' | 'githubFacts'>;
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
      'max tier': delegation.maxTier,
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

function rateOf(tally: RefuteTally): string | null {
  return tally.findings === 0 ? null : `${Math.round((tally.refuted / tally.findings) * 100)}%`;
}

async function refuteRows(scope: ListScope): Promise<readonly PlaneRow[]> {
  const events = await scope.tx.harnessEvents.read.recent({
    since: refuteSince(scope.at),
    names: refuteNames,
    agentsOnly: false,
    limit: PLANE_LIMIT,
  });
  return refuteTallies(events).map((tally) => ({
    harnessId: tally.harnessId,
    cells: {
      persona: tally.persona,
      findings: tally.findings,
      refuted: tally.refuted,
      rate: rateOf(tally),
    },
  }));
}

function heldFor(at: Date, since: Date | null): string | null {
  return since === null ? null : formatDuration(at.getTime() - since.getTime());
}

async function heldRows(scope: ListScope, kind: 'person' | 'agent'): Promise<readonly PlaneRow[]> {
  const holds = await holdsOf(scope.ports, scope.tx, scope.at);
  const rows = kind === 'person' ? holds.person : holds.agent;
  return rows.map(({ harness, item, holder }) => ({
    harnessId: harness.id,
    cells: {
      item: item.title,
      harness: harness.key,
      holder: holder.identity ?? 'A person who may decide',
      role: holder.role,
      since: holder.since === null ? null : formatInstant(holder.since),
      held: heldFor(scope.at, holder.since),
    },
  }));
}

async function silenceRows(scope: ListScope): Promise<readonly PlaneRow[]> {
  const found = await silences(scope.ports, scope.tx, scope.at);
  const loud = found.filter((silence) => silence.level !== 'ok');
  return loud.flatMap((silence) =>
    silence.waiting.map(({ item, enteredAt }) => ({
      harnessId: silence.harness.id,
      cells: {
        item: item.title,
        harness: silence.harness.key,
        level: silence.level,
        entered: formatInstant(enteredAt),
        waited: heldFor(scope.at, enteredAt),
        'last review step':
          silence.lastReviewStepAt === null ? null : formatInstant(silence.lastReviewStepAt),
      },
    })),
  );
}

type Reader = (scope: ListScope) => Promise<readonly PlaneRow[]>;

const readers: ReadonlyMap<PlaneIndicator, Reader> = new Map<PlaneIndicator, Reader>([
  ['spend', (scope) => runRows(scope, monthStart(scope.at))],
  ['runs_today', (scope) => runRows(scope, dayStart(scope.at))],
  ['live_delegations', delegationRows],
  ['gate_refusals_week', refusalRows],
  ['agent_writes', writeRows],
  ['stale_learnings', learningRows],
  ['reviewer_refutes', refuteRows],
  ['silence_alarm', silenceRows],
  ['held_by_person', (scope) => heldRows(scope, 'person')],
  ['held_by_agent', (scope) => heldRows(scope, 'agent')],
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
