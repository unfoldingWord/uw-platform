import { describe, expect, it } from 'vitest';
import {
  assistantIdentityOf,
  identitySchema,
  type AssistantChannel,
  type EventName,
  type NewHarnessEvent,
} from '@uw/contracts';
import type { AssistantEffectRow, AssistantRequestRow, StoreTransaction } from '../ports.ts';
import {
  assistantsBase,
  ensurePersonal,
  person,
  type AssistantsSubject,
} from './store-assistant-fixtures.ts';
import { hour, seedHarness, uid } from './store-gateway-fixtures.ts';

const base = 0x9b00;
const harnessId = uid(assistantsBase);
const start = new Date('2026-12-01T09:00:00.000Z');
const trace = uid(base + 0xfff);

type Asked = {
  readonly n: number;
  readonly hours: number;
  readonly channel?: AssistantChannel;
  readonly threadKey?: string;
};

function askedOf(asked: Asked): AssistantRequestRow {
  const recordedAt = new Date(start.getTime() + asked.hours * hour);
  return {
    id: uid(base + asked.n),
    harnessId,
    personId: person,
    channel: asked.channel ?? 'zulip_dm',
    externalId: `reads-${String(base + asked.n)}`,
    threadKey: asked.threadKey ?? 'reads',
    replyAddress: 'zulip:5005',
    note: `asked ${String(asked.n)}`,
    untrustedParts: [],
    receivedAt: recordedAt,
    recordedAt,
  };
}

function replyOf(request: AssistantRequestRow): AssistantEffectRow {
  return {
    id: uid(Number.parseInt(request.id.slice(-12), 16) - 0x5a0000000000 + 0x100),
    harnessId,
    requestId: request.id,
    kind: 'reply_to_requester',
    idempotencyKey: `reply:${request.id}`,
    payload: { text: `answered ${request.note}` },
    createdAt: request.recordedAt,
  };
}

let eventCount = 0;

function eventOf(
  name: EventName,
  evidence: NewHarnessEvent['evidence'],
  when: Date = start,
  onHarness: string = harnessId,
): NewHarnessEvent {
  eventCount += 1;
  return {
    eventId: uid(base * 0x10000 + eventCount),
    harnessId: onHarness,
    itemId: null,
    name,
    at: when.toISOString(),
    actor: identitySchema.parse(assistantIdentityOf(person)),
    evidence: { ...evidence },
    traceId: trace,
    requestId: null,
  };
}

type Fate = 'done' | 'dropped' | 'in_flight' | 'none';

async function asked(tx: StoreTransaction, request: AssistantRequestRow, fate: Fate) {
  await tx.assistantRequests.write.insert(request);
  if (fate === 'none') return;
  const effect = replyOf(request);
  await tx.assistantEffects.write.insert(effect);
  const kind = effect.kind;
  const settled =
    fate === 'done'
      ? [eventOf('assistant_effect_done', { effectId: effect.id, kind })]
      : fate === 'dropped'
        ? [eventOf('assistant_effect_failed', { effectId: effect.id, kind, why: 'dropped' })]
        : [];
  await tx.harnessEvents.write.append([
    eventOf('assistant_effect_started', { effectId: effect.id, requestId: request.id, kind }),
    ...settled,
  ]);
}

function threadOf(current: AssistantRequestRow, limit: number) {
  return {
    harnessId,
    channel: current.channel,
    threadKey: 'reads',
    before: { recordedAt: current.recordedAt, id: current.id },
    since: start,
    limit,
  };
}

function describeDeliveredInThread(subject: AssistantsSubject): void {
  it('reads only delivered exchanges of one channel and thread strictly before a request', async () => {
    const early = askedOf({ n: 1, hours: 1 });
    const later = askedOf({ n: 2, hours: 2 });
    const current = askedOf({ n: 6, hours: 6 });
    const read = await subject().store.transaction(async (tx) => {
      await ensurePersonal(tx);
      await asked(tx, early, 'done');
      await asked(tx, later, 'done');
      await asked(tx, askedOf({ n: 3, hours: 3 }), 'dropped');
      await asked(tx, askedOf({ n: 4, hours: 4 }), 'in_flight');
      await asked(tx, askedOf({ n: 5, hours: 5, channel: 'email' }), 'done');
      await asked(tx, askedOf({ n: 7, hours: 2.5, threadKey: 'other' }), 'done');
      await asked(tx, current, 'none');
      await asked(tx, askedOf({ n: 8, hours: 7 }), 'done');
      return {
        two: await tx.assistantRequests.read.deliveredInThread(threadOf(current, 2)),
        one: await tx.assistantRequests.read.deliveredInThread(threadOf(current, 1)),
      };
    });
    expect(read.two.map((row) => row.id)).toEqual([early.id, later.id]);
    expect(read.one.map((row) => row.id)).toEqual([later.id]);
  });

  it('orders requests recorded at the same instant by id', async () => {
    const tied = askedOf({ n: 0x11, hours: 20, threadKey: 'reads' });
    const current = askedOf({ n: 0x12, hours: 20 });
    const after = askedOf({ n: 0x13, hours: 20 });
    const read = await subject().store.transaction(async (tx) => {
      await ensurePersonal(tx);
      await asked(tx, tied, 'done');
      await asked(tx, current, 'none');
      await asked(tx, after, 'done');
      return tx.assistantRequests.read.deliveredInThread({
        ...threadOf(current, 12),
        since: new Date(start.getTime() + 19 * hour),
      });
    });
    expect(read.map((row) => row.id)).toEqual([tied.id]);
  });
}

function describeLedger(subject: AssistantsSubject): void {
  it('reads the lifecycle of one request or effect, before any bound applies', async () => {
    const mine = askedOf({ n: 0x21, hours: 30, threadKey: 'ledger' });
    const effect = replyOf(mine);
    const others = [0x22, 0x23, 0x24].map((n) => askedOf({ n, hours: 30, threadKey: 'ledger' }));
    const read = await subject().store.transaction(async (tx) => {
      await ensurePersonal(tx);
      await asked(tx, mine, 'done');
      const started = (request: AssistantRequestRow) =>
        eventOf('assistant_turn_started', {
          requestId: request.id,
          turnId: request.id,
          attemptId: request.id,
          delegationId: request.id,
          personaVersion: 1,
        });
      await tx.harnessEvents.write.append([started(mine), ...others.map(started)]);
      const names: readonly EventName[] = ['assistant_turn_started'];
      return {
        request: await tx.harnessEvents.read.assistantLedger({
          harnessId,
          names,
          about: { requestId: mine.id },
          limit: 1,
        }),
        effect: await tx.harnessEvents.read.assistantLedger({
          harnessId,
          names: ['assistant_effect_done', 'assistant_effect_failed'],
          about: { effectId: effect.id },
          limit: 1,
        }),
      };
    });
    expect(read.request.map((event) => event.evidence['requestId'])).toEqual([mine.id]);
    expect(read.effect.map((event) => [event.name, event.evidence['effectId']])).toEqual([
      ['assistant_effect_done', effect.id],
    ]);
  });

  it('refuses a lifecycle read of no events or of more than a hundred', async () => {
    const query = { harnessId, names: [], about: { requestId: uid(base + 0x21) } };
    for (const limit of [0, 101]) {
      await expect(
        subject().store.transaction((tx) =>
          tx.harnessEvents.read.assistantLedger({ ...query, limit }),
        ),
      ).rejects.toThrow(RangeError);
    }
  });
}

function finishedOf(costMicros: number | null, when: Date, onHarness = harnessId) {
  return eventOf(
    'assistant_turn_finished',
    {
      requestId: uid(base + 0x30),
      turnId: uid(base + 0x31),
      outcome: 'ended',
      turns: 1,
      inputTokens: 1,
      outputTokens: 1,
      costMicros,
      tools: [],
    },
    when,
    onHarness,
  );
}

function startedOf(turn: number, when: Date, onHarness = harnessId) {
  return eventOf(
    'assistant_turn_started',
    {
      requestId: uid(base + 0x30),
      turnId: uid(base + turn),
      attemptId: uid(base + 0x36),
      delegationId: uid(base + 0x35),
      personaVersion: 1,
    },
    when,
    onHarness,
  );
}

function describeSpend(subject: AssistantsSubject): void {
  it('sums a month of 4,000 turns at 4,000 micros to 16 units, counting unknown costs and open turns apart', async () => {
    const month = new Date('2027-03-01T00:00:00.000Z');
    const inMonth = new Date('2027-03-02T09:00:00.000Z');
    const spend = await subject().store.transaction(async (tx) => {
      await ensurePersonal(tx);
      await seedHarness(tx, 0x9c00, 'assistant-spend-elsewhere');
      const turns = Array.from({ length: 4_000 }, () => finishedOf(4_000, inMonth));
      await tx.harnessEvents.write.append([
        ...turns,
        finishedOf(null, inMonth),
        finishedOf(null, inMonth),
        finishedOf(9_000_000, new Date('2027-02-28T23:59:59.000Z')),
        finishedOf(9_000_000, inMonth, uid(0x9c00)),
        startedOf(0x31, inMonth),
        startedOf(0x32, inMonth),
        startedOf(0x33, new Date('2027-02-28T23:59:59.000Z')),
        startedOf(0x34, inMonth, uid(0x9c00)),
      ]);
      return tx.harnessEvents.read.assistantSpend({ harnessId, since: month });
    });
    expect(spend).toEqual({ knownMicros: 16_000_000, unknownTurns: 2, openTurns: 1 });
  }, 120_000);

  it('reads an empty month as nothing spent', async () => {
    const spend = await subject().store.transaction((tx) =>
      tx.harnessEvents.read.assistantSpend({ harnessId: uid(base + 0x99), since: start }),
    );
    expect(spend).toEqual({ knownMicros: 0, unknownTurns: 0, openTurns: 0 });
  });
}

export function describeStoreAssistantReads(subject: AssistantsSubject): void {
  describe('assistant reads bounded by their own request, thread and month', () => {
    describeDeliveredInThread(subject);
    describeLedger(subject);
    describeSpend(subject);
  });
}
