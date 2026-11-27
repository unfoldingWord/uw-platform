import {
  assistantTurnRefusalSchema,
  type AssistantChannel,
  type AssistantEffectKind,
  type AssistantTurnRefusal,
  type HarnessEvent,
} from '@uw/contracts';
import type {
  AssistantEffectRow,
  AssistantHoldRow,
  AssistantReminderRow,
  RecentRequest,
  StoreTransaction,
} from '../ports.ts';

type EffectState = 'started' | 'done' | 'failed' | 'undone';
export type OverviewEffect = {
  readonly effectId: string;
  readonly kind: AssistantEffectKind;
  readonly state: EffectState;
  readonly why: string | null;
  readonly undoable: boolean;
};
export type OverviewRequest = {
  readonly requestId: string;
  readonly channel: AssistantChannel;
  readonly recordedAt: Date;
  readonly note: string;
  readonly quoted: number;
  readonly redacted: boolean;
  readonly effects: readonly OverviewEffect[];
  readonly refused: AssistantTurnRefusal | null;
};
export type Live = {
  readonly reminders: readonly AssistantReminderRow[];
  readonly holds: readonly AssistantHoldRow[];
  readonly at: Date;
};

const SETTLING = [
  'assistant_effect_done',
  'assistant_effect_failed',
  'assistant_effect_undone',
  'assistant_turn_refused',
];
const EVENTS_MOST = 1000;
type Settled = { readonly state: EffectState; readonly why: string | null };

export async function settlingEvents(
  tx: StoreTransaction,
  harnessId: string,
  since: Date,
): Promise<readonly HarnessEvent[]> {
  return tx.harnessEvents.read.recent({
    since,
    names: SETTLING as HarnessEvent['name'][],
    agentsOnly: false,
    limit: EVENTS_MOST,
    harnessIds: [harnessId],
  });
}

function settledOf(events: readonly HarnessEvent[]): ReadonlyMap<string, Settled> {
  const settled = new Map<string, Settled>();
  for (const event of [...events].reverse()) {
    const effectId = event.evidence['effectId'];
    if (typeof effectId !== 'string') continue;
    if (event.name === 'assistant_effect_undone')
      settled.set(effectId, { state: 'undone', why: null });
    else if (settled.get(effectId)?.state !== 'undone') {
      const why = event.evidence['why'];
      const failed = event.name === 'assistant_effect_failed';
      settled.set(effectId, {
        state: failed ? 'failed' : 'done',
        why: failed && typeof why === 'string' ? why : null,
      });
    }
  }
  return settled;
}

function undoable(effect: AssistantEffectRow, live: Live): boolean {
  if (effect.kind === 'reminder_set') {
    return live.reminders.some((reminder) => reminder.effectId === effect.id);
  }
  if (effect.kind !== 'calendar_hold_added') return false;
  return live.holds.some(
    (hold) => hold.id === effect.id && hold.endsAt.getTime() > live.at.getTime(),
  );
}

function effectOf(effect: AssistantEffectRow, settled: Settled | undefined, live: Live) {
  const state = settled?.state ?? 'started';
  const shown: OverviewEffect = {
    effectId: effect.id,
    kind: effect.kind,
    state,
    why: settled?.why ?? null,
    undoable: state === 'done' && undoable(effect, live),
  };
  return shown;
}

function refusalsOf(events: readonly HarnessEvent[]): ReadonlyMap<string, AssistantTurnRefusal> {
  const refusals = new Map<string, AssistantTurnRefusal>();
  for (const event of events) {
    if (event.name !== 'assistant_turn_refused') continue;
    const requestId = event.evidence['requestId'];
    const why = assistantTurnRefusalSchema.safeParse(event.evidence['why']);
    if (typeof requestId === 'string' && why.success) refusals.set(requestId, why.data);
  }
  return refusals;
}

export function requestsOf(
  requests: readonly RecentRequest[],
  effects: readonly AssistantEffectRow[],
  events: readonly HarnessEvent[],
  live: Live,
): readonly OverviewRequest[] {
  const settled = settledOf(events);
  const refusals = refusalsOf(events);
  return requests.map((request) => ({
    requestId: request.id,
    channel: request.channel,
    recordedAt: request.recordedAt,
    note: request.note,
    quoted: request.untrustedParts.length,
    redacted: request.redactedAt !== null,
    effects: effects
      .filter((effect) => effect.requestId === request.id)
      .map((effect) => effectOf(effect, settled.get(effect.id), live)),
    refused: refusals.get(request.id) ?? null,
  }));
}
