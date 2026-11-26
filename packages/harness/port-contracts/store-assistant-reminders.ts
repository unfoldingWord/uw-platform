import { expect, it } from 'vitest';
import type {
  AssistantEffectRow,
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

const day = 24 * hour;
const reminderBase = base + 0x600;

function requestOf(): AssistantRequestRow {
  return {
    id: uid(reminderBase),
    harnessId: uid(base),
    personId: person,
    channel: 'zulip_dm',
    externalId: `reminders-${String(reminderBase)}`,
    threadKey: 'dm',
    replyAddress: 'zulip:5005',
    note: 'Remind me',
    untrustedParts: [],
    receivedAt: at,
    recordedAt: at,
  };
}

function effectOf(n: number, createdAt: Date): AssistantEffectRow {
  return {
    id: uid(reminderBase + 0x10 + n),
    harnessId: uid(base),
    requestId: uid(reminderBase),
    kind: 'reminder_set',
    idempotencyKey: `reminder_set:${uid(reminderBase)}:${String(n)}`,
    payload: { text: `reminder ${String(n)}`, dueAt: at.toISOString() },
    createdAt,
  };
}

function reminderOf(n: number, dueInDays: number): AssistantReminderRow {
  return {
    id: uid(reminderBase + 0x40 + n),
    harnessId: uid(base),
    personId: person,
    requestId: uid(reminderBase),
    effectId: uid(reminderBase + 0x10 + n),
    text: `reminder ${String(n)}`,
    dueAt: new Date(at.getTime() + dueInDays * day),
    status: 'set',
    closedAt: null,
    createdAt: at,
  };
}

async function seeded(tx: StoreTransaction, count: number): Promise<void> {
  await ensurePersonal(tx);
  if ((await tx.assistantRequests.read.byId(uid(reminderBase))) === null) {
    await tx.assistantRequests.write.insert(requestOf());
  }
  for (let n = 1; n <= count; n += 1) {
    await tx.assistantEffects.write.insert(effectOf(n, new Date(at.getTime() + n * hour)));
  }
}

function describeReminderWrites(subject: AssistantsSubject): void {
  it('reads a reminder back, and lists pending ones by due time within the limit', async () => {
    const read = await subject().store.transaction(async (tx) => {
      await seeded(tx, 3);
      for (const [n, days] of [
        [1, 30],
        [2, 10],
        [3, 20],
      ] as const) {
        await tx.assistantReminders.write.insert(reminderOf(n, days));
      }
      return {
        one: await tx.assistantReminders.read.byId(reminderOf(1, 30).id),
        missing: await tx.assistantReminders.read.byId(uid(reminderBase + 0x7f)),
        pending: await tx.assistantReminders.read.pending(uid(base), 2),
      };
    });
    expect(read.one).toEqual(reminderOf(1, 30));
    expect(read.missing).toBeNull();
    expect(read.pending.map((row) => row.id)).toEqual([reminderOf(2, 10).id, reminderOf(3, 20).id]);
  });

  it('closes a reminder only from the status it expects', async () => {
    const closing = new Date(at.getTime() + 11 * day);
    const read = await subject().store.transaction(async (tx) => {
      await seeded(tx, 4);
      await tx.assistantReminders.write.insert(reminderOf(4, 10));
      const id = reminderOf(4, 10).id;
      return {
        fired: await tx.assistantReminders.write.close({
          id,
          from: 'set',
          to: 'fired',
          at: closing,
        }),
        again: await tx.assistantReminders.write.close({
          id,
          from: 'set',
          to: 'cancelled',
          at: closing,
        }),
        row: await tx.assistantReminders.read.byId(id),
      };
    });
    expect([read.fired, read.again]).toEqual([true, false]);
    expect(read.row).toEqual({ ...reminderOf(4, 10), status: 'fired', closedAt: closing });
  });
}

function describeReminderReads(subject: AssistantsSubject): void {
  it('reads the due reminders that are still set, oldest due first, within the limit', async () => {
    const due = await subject().store.transaction(async (tx) => {
      await seeded(tx, 7);
      for (const [n, days] of [
        [5, 2],
        [6, 1],
        [7, 90],
      ] as const) {
        await tx.assistantReminders.write.insert(reminderOf(n, days));
      }
      const now = new Date(at.getTime() + 15 * day);
      return {
        two: await tx.assistantReminders.read.due(now, 2),
        all: await tx.assistantReminders.read.due(now, 50),
      };
    });
    expect(due.two.map((row) => row.id)).toEqual([reminderOf(6, 1).id, reminderOf(5, 2).id]);
    expect(due.all.map((row) => row.id)).toContain(reminderOf(2, 10).id);
    expect(due.all.map((row) => row.id)).not.toContain(reminderOf(4, 10).id);
    expect(due.all.map((row) => row.id)).not.toContain(reminderOf(7, 90).id);
    expect(due.all.every((row) => row.status === 'set')).toBe(true);
  });

  it('counts the effects of one kind created since an instant', async () => {
    const counted = await subject().store.transaction(async (tx) => {
      await seeded(tx, 7);
      return {
        since: await tx.assistantEffects.read.countSince(
          uid(base),
          'reminder_set',
          new Date(at.getTime() + 5 * hour),
        ),
        replies: await tx.assistantEffects.read.countSince(uid(base), 'reminder_cancelled', at),
      };
    });
    expect(counted).toEqual({ since: 3, replies: 0 });
  });

  it('refuses a due read of more than two hundred reminders', async () => {
    await expect(
      subject().store.transaction((tx) => tx.assistantReminders.read.due(at, 201)),
    ).rejects.toThrow(RangeError);
  });
}

export function describeStoreAssistantReminders(subject: AssistantsSubject): void {
  describeReminderWrites(subject);
  describeReminderReads(subject);
}
