import { expect, it } from 'vitest';
import type {
  AssistantEffectRow,
  AssistantHoldRow,
  AssistantReminderRow,
  AssistantRequestRow,
  StoreTransaction,
} from '../ports.ts';
import {
  assistantsBase as base,
  ensurePersonal,
  person,
  type AssistantsSubject,
} from './store-assistant-fixtures.ts';
import { at, hour, uid } from './store-gateway-fixtures.ts';

const historyBase = base + 0xa00;
const day = 24 * hour;
const longAgo = (days: number) => new Date(at.getTime() - days * day);
const cutoff = longAgo(1500);

function requestOf(n: number, days: number): AssistantRequestRow {
  return {
    id: uid(historyBase + n),
    harnessId: uid(base),
    personId: person,
    channel: 'zulip_dm',
    externalId: `history-${String(historyBase + n)}`,
    threadKey: 'dm',
    replyAddress: 'zulip:5005',
    note: `Remember ${String(n)}`,
    untrustedParts: [{ source: 'chat_quote', text: 'quoted' }],
    receivedAt: longAgo(days),
    recordedAt: longAgo(days),
  };
}

function effectOf(n: number, request: number, kind: AssistantEffectRow['kind']) {
  const effect: AssistantEffectRow = {
    id: uid(historyBase + 0x40 + n),
    harnessId: uid(base),
    requestId: uid(historyBase + request),
    kind,
    idempotencyKey: `history:${String(n)}`,
    payload: { text: `Reply ${String(n)}` },
    createdAt: longAgo(2000),
  };
  return effect;
}

function reminderOf(n: number, status: AssistantReminderRow['status']): AssistantReminderRow {
  return {
    id: uid(historyBase + 0x80 + n),
    harnessId: uid(base),
    personId: person,
    requestId: uid(historyBase + 1),
    effectId: uid(historyBase + 0x40 + n),
    text: `Call ${String(n)}`,
    dueAt: longAgo(1999),
    status,
    closedAt: status === 'set' ? null : longAgo(1999),
    createdAt: longAgo(2000),
  };
}

function holdOf(n: number, endsDaysAgo: number): AssistantHoldRow {
  const id = uid(historyBase + 0x40 + n);
  const endsAt = longAgo(endsDaysAgo);
  return {
    id,
    harnessId: uid(base),
    personId: person,
    eventId: id.replaceAll('-', ''),
    title: `Hold ${String(n)}`,
    startsAt: new Date(endsAt.getTime() - hour),
    endsAt,
    status: 'held',
    releasedEffectId: null,
    releasedAt: null,
    createdAt: longAgo(2000),
  };
}

async function seeded(tx: StoreTransaction): Promise<void> {
  await ensurePersonal(tx);
  if ((await tx.assistantRequests.read.byId(uid(historyBase + 1))) !== null) return;
  await tx.assistantRequests.write.insert(requestOf(1, 2000));
  await tx.assistantRequests.write.insert(requestOf(2, 1000));
  await tx.assistantEffects.write.insert(effectOf(1, 1, 'reminder_set'));
  await tx.assistantEffects.write.insert(effectOf(2, 1, 'reminder_set'));
  await tx.assistantEffects.write.insert(effectOf(3, 1, 'calendar_hold_added'));
  await tx.assistantEffects.write.insert(effectOf(4, 1, 'calendar_hold_added'));
  await tx.assistantEffects.write.insert(effectOf(5, 2, 'reply_to_requester'));
  await tx.assistantReminders.write.insert(reminderOf(1, 'fired'));
  await tx.assistantReminders.write.insert(reminderOf(2, 'set'));
  await tx.assistantHolds.write.insert(holdOf(3, 1900));
  await tx.assistantHolds.write.insert({ ...holdOf(4, -10), startsAt: at, endsAt: longAgo(-1) });
}

function describeRecentAndById(subject: AssistantsSubject): void {
  it('lists a harness requests newest first within the limit, and reads one effect', async () => {
    const read = await subject().store.transaction(async (tx) => {
      await seeded(tx);
      return {
        recent: await tx.assistantRequests.read.recent(uid(base), 50),
        two: await tx.assistantRequests.read.recent(uid(base), 2),
        effect: await tx.assistantEffects.read.byId(effectOf(5, 2, 'reply_to_requester').id),
        missing: await tx.assistantEffects.read.byId(uid(historyBase + 0x7f)),
        reminder: await tx.assistantReminders.read.byEffect(reminderOf(2, 'set').effectId),
      };
    });
    const ids = new Set([uid(historyBase + 1), uid(historyBase + 2)]);
    const mine = read.recent.filter((row) => ids.has(row.id));
    expect(mine.map((row) => row.id)).toEqual([uid(historyBase + 2), uid(historyBase + 1)]);
    expect(mine[0]).toEqual({ ...requestOf(2, 1000), redactedAt: null });
    expect(read.two).toHaveLength(2);
    expect(read.effect).toEqual(effectOf(5, 2, 'reply_to_requester'));
    expect(read.missing).toBeNull();
    expect(read.reminder).toEqual(reminderOf(2, 'set'));
  });

  it('refuses a recent read of more than fifty requests', async () => {
    await expect(
      subject().store.transaction((tx) => tx.assistantRequests.read.recent(uid(base), 51)),
    ).rejects.toThrow(RangeError);
  });
}

function describeRedaction(subject: AssistantsSubject): void {
  it('redacts requests, their effects, closed reminders and ended holds before a time, once', async () => {
    const redacting = longAgo(1);
    const read = await subject().store.transaction(async (tx) => {
      await seeded(tx);
      const query = { harnessId: null, before: cutoff, at: redacting, limit: 100 };
      const requests = await tx.assistantRequests.write.redact(query);
      const effects = await tx.assistantEffects.write.redactFor(
        requests.map((row) => row.id),
        redacting,
      );
      return {
        requests,
        effects,
        reminders: await tx.assistantReminders.write.redact(query),
        holds: await tx.assistantHolds.write.redact(query),
        again: await tx.assistantRequests.write.redact(query),
        recent: await tx.assistantRequests.read.recent(uid(base), 50),
        effect: await tx.assistantEffects.read.byId(effectOf(1, 1, 'reminder_set').id),
        fired: await tx.assistantReminders.read.byId(reminderOf(1, 'fired').id),
        pending: await tx.assistantReminders.read.byId(reminderOf(2, 'set').id),
        ended: await tx.assistantHolds.read.byId(holdOf(3, 1900).id),
        ahead: await tx.assistantHolds.read.byId(holdOf(4, -10).id),
      };
    });
    expect(read.requests).toEqual([{ id: uid(historyBase + 1), harnessId: uid(base) }]);
    expect([read.effects, read.reminders, read.holds, read.again.length]).toEqual([4, 1, 1, 0]);
    const old = read.recent.find((row) => row.id === uid(historyBase + 1));
    expect(old).toMatchObject({ note: '', untrustedParts: [], redactedAt: redacting });
    expect(read.recent.find((row) => row.id === uid(historyBase + 2))?.redactedAt).toBeNull();
    expect(read.effect?.payload).toEqual({});
    expect(read.fired?.text).toBe('');
    expect(read.pending?.text).toBe('Call 2');
    expect(read.ended?.title).toBe('');
    expect(read.ahead?.title).toBe('Hold 4');
  });

  it('lets the person release a hold with no releasing effect', async () => {
    const read = await subject().store.transaction(async (tx) => {
      await seeded(tx);
      const change = { id: holdOf(4, -10).id, effectId: null, at };
      return {
        released: await tx.assistantHolds.write.release(change),
        row: await tx.assistantHolds.read.byId(change.id),
      };
    });
    expect(read.released).toBe(true);
    expect(read.row).toMatchObject({ status: 'released', releasedEffectId: null, releasedAt: at });
  });
}

export function describeStoreAssistantHistory(subject: AssistantsSubject): void {
  describeRecentAndById(subject);
  describeRedaction(subject);
}
