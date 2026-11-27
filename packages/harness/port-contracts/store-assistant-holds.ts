import { expect, it } from 'vitest';
import type {
  AssistantEffectRow,
  AssistantHoldRow,
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

const holdBase = base + 0x800;

function requestOf(): AssistantRequestRow {
  return {
    id: uid(holdBase),
    harnessId: uid(base),
    personId: person,
    channel: 'zulip_dm',
    externalId: `holds-${String(holdBase)}`,
    threadKey: 'dm',
    replyAddress: 'zulip:5005',
    note: 'Hold my mornings',
    untrustedParts: [],
    receivedAt: at,
    recordedAt: at,
  };
}

function effectOf(n: number): AssistantEffectRow {
  return {
    id: uid(holdBase + 0x10 + n),
    harnessId: uid(base),
    requestId: uid(holdBase),
    kind: n > 10 ? 'calendar_hold_removed' : 'calendar_hold_added',
    idempotencyKey: `calendar_hold:${uid(holdBase)}:${String(n)}`,
    payload: {},
    createdAt: at,
  };
}

function holdOf(n: number, startsInHours: number): AssistantHoldRow {
  const id = uid(holdBase + 0x10 + n);
  const startsAt = new Date(at.getTime() + startsInHours * hour);
  return {
    id,
    harnessId: uid(base),
    personId: person,
    eventId: id.replaceAll('-', ''),
    title: `Hold ${String(n)}`,
    startsAt,
    endsAt: new Date(startsAt.getTime() + hour),
    status: 'held',
    releasedEffectId: null,
    releasedAt: null,
    createdAt: at,
  };
}

async function seeded(tx: StoreTransaction, effects: readonly number[]): Promise<void> {
  await ensurePersonal(tx);
  if ((await tx.assistantRequests.read.byId(uid(holdBase))) === null) {
    await tx.assistantRequests.write.insert(requestOf());
  }
  for (const n of effects) await tx.assistantEffects.write.insert(effectOf(n));
}

function describeHoldWrites(subject: AssistantsSubject): void {
  it('places a hold once, reads it back and lists held ones by start within the limit', async () => {
    const read = await subject().store.transaction(async (tx) => {
      await seeded(tx, [1, 2, 3]);
      const first = await tx.assistantHolds.write.insert(holdOf(1, 30));
      const again = await tx.assistantHolds.write.insert(holdOf(1, 30));
      await tx.assistantHolds.write.insert(holdOf(2, 10));
      await tx.assistantHolds.write.insert(holdOf(3, 20));
      return {
        first,
        again,
        one: await tx.assistantHolds.read.byId(holdOf(1, 30).id),
        missing: await tx.assistantHolds.read.byId(uid(holdBase + 0x7f)),
        held: await tx.assistantHolds.read.held(uid(base), 2),
      };
    });
    expect([read.first, read.again]).toEqual([true, false]);
    expect(read.one).toEqual(holdOf(1, 30));
    expect(read.missing).toBeNull();
    expect(read.held.map((row) => row.id)).toEqual([holdOf(2, 10).id, holdOf(3, 20).id]);
  });

  it('releases a held hold once, with the effect that released it', async () => {
    const releasing = new Date(at.getTime() + 2 * hour);
    const read = await subject().store.transaction(async (tx) => {
      await seeded(tx, [4, 14]);
      await tx.assistantHolds.write.insert(holdOf(4, 40));
      const change = { id: holdOf(4, 40).id, effectId: effectOf(14).id, at: releasing };
      return {
        released: await tx.assistantHolds.write.release(change),
        again: await tx.assistantHolds.write.release(change),
        row: await tx.assistantHolds.read.byId(change.id),
        held: await tx.assistantHolds.read.held(uid(base), 50),
      };
    });
    expect([read.released, read.again]).toEqual([true, false]);
    expect(read.row).toEqual({
      ...holdOf(4, 40),
      status: 'released',
      releasedEffectId: effectOf(14).id,
      releasedAt: releasing,
    });
    expect(read.held.map((row) => row.id)).not.toContain(holdOf(4, 40).id);
  });

  it('refuses a held read of more than two hundred holds', async () => {
    await expect(
      subject().store.transaction((tx) => tx.assistantHolds.read.held(uid(base), 201)),
    ).rejects.toThrow(RangeError);
  });
}

export function describeStoreAssistantHolds(subject: AssistantsSubject): void {
  describeHoldWrites(subject);
}
