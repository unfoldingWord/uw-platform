import { verbIo, type AssistantEffectFailure } from '@uw/contracts';
import type { Caller } from '../caller.ts';
import { draft, recordContext, recordHarnessEvents, type EventDraft } from '../items/record.ts';
import type { RecordContext } from '../items/record.ts';
import { lockKeys } from '../lock-keys.ts';
import type {
  AssistantEffectRow,
  AssistantRequestRow,
  HoldPlacement,
  HoldRemoved,
  Ports,
  StoreTransaction,
} from '../ports.ts';
import { askCalendar, calendarFailure } from './calendar-port.ts';
import { boundAssist } from './delegation.ts';
import { anyNamed, requestEvents, startedTurn } from './ledger.ts';
import { unsettledDrafts } from './settled.ts';
import { claimOf, type FinishInput } from './settle.ts';

type ApplyPorts = Pick<Ports, 'clock' | 'grants' | 'ids' | 'store' | 'workspace'>;
type Add = {
  readonly kind: 'add';
  readonly effect: AssistantEffectRow;
  readonly title: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
};
type Remove = {
  readonly kind: 'remove';
  readonly effect: AssistantEffectRow;
  readonly holdId: string;
  readonly eventId: string | null;
};
type Task = Add | Remove;
type Answer = HoldPlacement | HoldRemoved | { readonly outcome: 'not_wired' };
type Done = { readonly task: Task; readonly answer: Answer };
type Plan = { readonly request: AssistantRequestRow; readonly tasks: readonly Task[] };

const CALENDAR_KINDS: ReadonlySet<string> = new Set([
  'calendar_hold_added',
  'calendar_hold_removed',
]);

async function openRequest(
  tx: StoreTransaction,
  ports: ApplyPorts,
  context: RecordContext,
  input: FinishInput,
): Promise<AssistantRequestRow | null> {
  await tx.lock(lockKeys.assistantRequest(input.requestId));
  const request = await tx.assistantRequests.read.byId(input.requestId);
  if (request === null) return null;
  await tx.lock(lockKeys.assistantHarness(request.harnessId));
  const events = await requestEvents(tx, request, [
    'assistant_turn_started',
    'assistant_turn_finished',
  ]);
  const started = startedTurn(events, input.turnId);
  if (started === null || anyNamed(events, 'assistant_turn_finished')) return null;
  if ((await claimOf(tx, request)) !== null) return null;
  const assist = await boundAssist(tx, ports, context, started.delegationId);
  return assist === null ? null : request;
}

async function taskOf(tx: StoreTransaction, effect: AssistantEffectRow): Promise<Task> {
  if (effect.kind === 'calendar_hold_added') {
    const hold = verbIo.hold_time.input.parse(effect.payload);
    const { title } = hold;
    return {
      kind: 'add',
      effect,
      title,
      startsAt: new Date(hold.start),
      endsAt: new Date(hold.end),
    };
  }
  const { holdId } = verbIo.release_hold.input.parse(effect.payload);
  const hold = await tx.assistantHolds.read.byId(holdId);
  const own = hold !== null && hold.harnessId === effect.harnessId && hold.status === 'held';
  return { kind: 'remove', effect, holdId, eventId: own ? hold.eventId : null };
}

async function planIn(
  tx: StoreTransaction,
  ports: ApplyPorts,
  context: RecordContext,
  input: FinishInput,
): Promise<Plan | null> {
  const request = await openRequest(tx, ports, context, input);
  if (request === null) return null;
  const drafts = (await unsettledDrafts(tx, request)).filter((effect) =>
    CALENDAR_KINDS.has(effect.kind),
  );
  const tasks: Task[] = [];
  for (const effect of drafts) tasks.push(await taskOf(tx, effect));
  return { request, tasks };
}

function ask(ports: ApplyPorts, request: AssistantRequestRow, task: Task): Promise<Answer> {
  const marker = { harnessId: request.harnessId, holdId: task.effect.id };
  if (task.kind === 'add') {
    const { title, startsAt, endsAt } = task;
    const hold = { ...marker, personId: request.personId, title, startsAt, endsAt };
    return askCalendar(() => ports.workspace.placeHold(hold)).then(answered);
  }
  const { eventId } = task;
  if (eventId === null) return Promise.resolve({ outcome: 'not_own_hold' });
  const removal = {
    personId: request.personId,
    harnessId: request.harnessId,
    holdId: task.holdId,
    eventId,
  };
  return askCalendar(() => ports.workspace.removeHold(removal)).then(answered);
}

function answered<T extends Answer>(answer: T | 'not_wired'): Answer {
  return answer === 'not_wired' ? { outcome: 'not_wired' } : answer;
}

function whyOf(answer: Answer): AssistantEffectFailure {
  if (answer.outcome === 'not_own_hold') return 'not_own_hold';
  if (answer.outcome === 'refused' || answer.outcome === 'unavailable') {
    return calendarFailure(answer.outcome);
  }
  return 'not_wired';
}

function failedDraft(effect: AssistantEffectRow, why: AssistantEffectFailure): EventDraft {
  return draft('assistant_effect_failed', { effectId: effect.id, kind: effect.kind, why });
}

function doneDraft(effect: AssistantEffectRow): EventDraft {
  return draft('assistant_effect_done', { effectId: effect.id, kind: effect.kind });
}

async function placed(
  tx: StoreTransaction,
  context: RecordContext,
  request: AssistantRequestRow,
  task: Add,
  eventId: string,
): Promise<readonly EventDraft[]> {
  const { effect } = task;
  await tx.assistantHolds.write.insert({
    id: effect.id,
    harnessId: request.harnessId,
    personId: request.personId,
    eventId,
    title: task.title,
    startsAt: task.startsAt,
    endsAt: task.endsAt,
    status: 'held',
    releasedEffectId: null,
    releasedAt: null,
    createdAt: context.at,
  });
  return [
    draft('assistant_hold_placed', { holdId: effect.id, effectId: effect.id }),
    doneDraft(effect),
  ];
}

async function released(
  tx: StoreTransaction,
  context: RecordContext,
  task: Remove,
): Promise<readonly EventDraft[]> {
  const { effect, holdId } = task;
  const change = { id: holdId, effectId: effect.id, at: context.at };
  if (!(await tx.assistantHolds.write.release(change))) return [doneDraft(effect)];
  return [draft('assistant_hold_released', { holdId, effectId: effect.id }), doneDraft(effect)];
}

function settleOne(
  tx: StoreTransaction,
  context: RecordContext,
  request: AssistantRequestRow,
  done: Done,
): Promise<readonly EventDraft[]> {
  const { task, answer } = done;
  if (task.kind === 'add' && answer.outcome === 'held' && 'eventId' in answer) {
    return placed(tx, context, request, task, answer.eventId);
  }
  if (task.kind === 'remove' && answer.outcome === 'released') {
    return released(tx, context, task);
  }
  return Promise.resolve([failedDraft(task.effect, whyOf(answer))]);
}

async function recordIn(
  tx: StoreTransaction,
  context: RecordContext,
  request: AssistantRequestRow,
  results: readonly Done[],
): Promise<void> {
  await tx.lock(lockKeys.assistantHarness(request.harnessId));
  const open = new Set((await unsettledDrafts(tx, request)).map((effect) => effect.id));
  const events: EventDraft[] = [];
  for (const done of results) {
    if (open.has(done.task.effect.id))
      events.push(...(await settleOne(tx, context, request, done)));
  }
  if (events.length > 0) await recordHarnessEvents(tx, context, request.harnessId, events);
}

function noteOf(done: Done): string | null {
  const { task, answer } = done;
  if (answer.outcome === 'held' || answer.outcome === 'released') return null;
  const why = whyOf(answer);
  return task.kind === 'add'
    ? `I could not place the hold "${task.title}" on your calendar (${why}).`
    : `I could not remove the hold from your calendar (${why}).`;
}

export async function applyCalendarDrafts(
  ports: ApplyPorts,
  caller: Caller,
  input: FinishInput,
): Promise<readonly string[]> {
  const context = recordContext(ports, caller, ports.clock.now());
  const plan = await ports.store.transaction((tx) => planIn(tx, ports, context, input));
  if (plan === null || plan.tasks.length === 0) return [];
  const results: Done[] = [];
  for (const task of plan.tasks)
    results.push({ task, answer: await ask(ports, plan.request, task) });
  const closing = recordContext(ports, caller, ports.clock.now());
  await ports.store.transaction((tx) => recordIn(tx, closing, plan.request, results));
  return results.map(noteOf).filter((note): note is string => note !== null);
}
