import { describe, expect, it } from 'vitest';
import { assistantIdentityOf, identitySchema } from '@uw/contracts';
import type {
  AssistantEffectRow,
  AssistantRequestRow,
  AssistantSettingsRow,
  StoreTransaction,
} from '../ports.ts';
import {
  assistantsBase as base,
  ensurePersonal,
  person,
  personalHarness,
  type AssistantsSubject,
} from './store-assistant-fixtures.ts';
import { describeStoreAssistantAccounts } from './store-assistant-accounts.ts';
import { describeStoreAssistantBudgets } from './store-assistant-budgets.ts';
import { describeStoreAssistantReads } from './store-assistant-reads.ts';
import { describeStoreAssistantPairing } from './store-assistant-pairing.ts';
import { describeStoreAssistantReminders } from './store-assistant-reminders.ts';
import { describeStoreAssistantHolds } from './store-assistant-holds.ts';
import { at, hour, refusedBy, uid } from './store-gateway-fixtures.ts';

function requestOf(n: number, threadKey: string | null, recorded: number): AssistantRequestRow {
  return {
    id: uid(base + 0x10 + n),
    harnessId: uid(base),
    personId: person,
    channel: 'zulip_dm',
    externalId: `external-${String(base + n)}`,
    threadKey,
    replyAddress: 'zulip:5005',
    note: `note ${String(n)}`,
    untrustedParts: n === 1 ? [{ source: 'chat_quote', text: 'quoted' }] : [],
    receivedAt: new Date(at.getTime() + recorded * hour),
    recordedAt: new Date(at.getTime() + recorded * hour),
  };
}

async function delivered(tx: StoreTransaction, effect: AssistantEffectRow): Promise<void> {
  await tx.assistantEffects.write.insert(effect);
  await tx.harnessEvents.write.append([
    {
      eventId: uid(base + 0x400 + Number.parseInt(effect.id.slice(-4), 16)),
      harnessId: effect.harnessId,
      itemId: null,
      name: 'assistant_effect_done',
      at: effect.createdAt.toISOString(),
      actor: identitySchema.parse(assistantIdentityOf(person)),
      evidence: { effectId: effect.id, kind: effect.kind },
      traceId: uid(base + 0x3ff),
      requestId: null,
    },
  ]);
}

function effectOf(n: number, requestId: string, key = `reply:${requestId}`): AssistantEffectRow {
  return {
    id: uid(base + 0x80 + n),
    harnessId: uid(base),
    requestId,
    kind: 'reply_to_requester',
    idempotencyKey: key,
    payload: { text: `reply ${String(n)}` },
    createdAt: new Date(at.getTime() + n * hour),
  };
}

function settingsOf(version: number, displayName: string): AssistantSettingsRow {
  return {
    harnessId: uid(base),
    personId: person,
    displayName,
    instructionsMd: 'Keep replies short.',
    timezone: 'Africa/Nairobi',
    version,
    updatedAt: new Date(at.getTime() + version * hour),
  };
}

function describeHarnessAndSettings(adapter: string, subject: AssistantsSubject): void {
  it(`finds a personal harness by its person on ${adapter}, and none for a stranger`, async () => {
    const read = await subject().store.transaction(async (tx) => {
      await ensurePersonal(tx);
      return {
        mine: await tx.harnesses.read.byPerson(person),
        stranger: await tx.harnesses.read.byPerson(uid(base + 0xff)),
        workflow: await tx.harnesses.read.byId(uid(base)),
      };
    });
    expect(read.mine).toEqual(personalHarness());
    expect(read.workflow?.personId).toBe(person);
    expect(read.stranger).toBeNull();
  });

  it('refuses a second assistant harness for the same person', async () => {
    const second = { ...personalHarness(), id: uid(base + 1), key: 'assistant-second' };
    const refusal = await refusedBy(async (tx) => {
      await ensurePersonal(tx);
      await tx.harnesses.write.insert(second, at);
    }, subject().store);
    expect(refusal?.code).toBe('23505');
  });

  it('upserts settings only at the expected version', async () => {
    const read = await subject().store.transaction(async (tx) => {
      await ensurePersonal(tx);
      const first = await tx.assistantSettings.write.upsert(settingsOf(1, 'Ada'), 0);
      const again = await tx.assistantSettings.write.upsert(settingsOf(1, 'Bea'), 0);
      const stale = await tx.assistantSettings.write.upsert(settingsOf(3, 'Cy'), 2);
      const next = await tx.assistantSettings.write.upsert(settingsOf(2, 'Di'), 1);
      return {
        first,
        again,
        stale,
        next,
        row: await tx.assistantSettings.read.byHarness(uid(base)),
      };
    });
    expect([read.first, read.again, read.stale, read.next]).toEqual([true, false, false, true]);
    expect(read.row).toEqual(settingsOf(2, 'Di'));
    expect(
      await subject().store.transaction((tx) => tx.assistantSettings.read.byHarness(uid(base + 9))),
    ).toBeNull();
  });
}

function describeRequests(subject: AssistantsSubject): void {
  it('reads a request back by id and by its channel and external id', async () => {
    const request = requestOf(1, 'dm', 0);
    const read = await subject().store.transaction(async (tx) => {
      await ensurePersonal(tx);
      await tx.assistantRequests.write.insert(request);
      return {
        byId: await tx.assistantRequests.read.byId(request.id),
        byExternal: await tx.assistantRequests.read.byExternal('zulip_dm', request.externalId),
        otherChannel: await tx.assistantRequests.read.byExternal('email', request.externalId),
      };
    });
    expect(read.byId).toEqual(request);
    expect(read.byExternal).toEqual(request);
    expect(read.otherChannel).toBeNull();
  });

  it('refuses a second request with the same channel and external id', async () => {
    const twin = { ...requestOf(1, 'dm', 0), id: uid(base + 0x1f) };
    const refusal = await refusedBy(async (tx) => {
      await ensurePersonal(tx);
      await tx.assistantRequests.write.insert(twin);
    }, subject().store);
    expect(refusal?.code).toBe('23505');
  });
}

function describeThread(subject: AssistantsSubject): void {
  it('reads the delivered requests of one thread oldest first, within the window and the limit', async () => {
    const rows = [requestOf(2, 'thread', 1), requestOf(3, 'thread', 2), requestOf(4, 'thread', 3)];
    const current = requestOf(7, 'thread', 4);
    const read = await subject().store.transaction(async (tx) => {
      await ensurePersonal(tx);
      for (const row of [...rows, requestOf(5, 'elsewhere', 4), current]) {
        await tx.assistantRequests.write.insert(row);
      }
      for (const [n, row] of rows.entries()) await delivered(tx, effectOf(0x10 + n, row.id));
      const query = {
        harnessId: uid(base),
        channel: 'zulip_dm' as const,
        threadKey: 'thread',
        before: { recordedAt: current.recordedAt, id: current.id },
        since: at,
        limit: 2,
      };
      return {
        two: await tx.assistantRequests.read.deliveredInThread(query),
        windowed: await tx.assistantRequests.read.deliveredInThread({
          ...query,
          since: new Date(at.getTime() + 2 * hour),
          limit: 12,
        }),
      };
    });
    expect(read.two.map((row) => row.id)).toEqual([rows[1]?.id, rows[2]?.id]);
    expect(read.windowed.map((row) => row.id)).toEqual([rows[1]?.id, rows[2]?.id]);
  });
}

function describeThreadBound(subject: AssistantsSubject): void {
  it('refuses a thread read of more than twelve requests', async () => {
    const query = {
      harnessId: uid(base),
      channel: 'zulip_dm' as const,
      threadKey: 'thread',
      before: { recordedAt: at, id: uid(base) },
      since: at,
      limit: 13,
    };
    await expect(
      subject().store.transaction((tx) => tx.assistantRequests.read.deliveredInThread(query)),
    ).rejects.toThrow(RangeError);
  });
}

function describeEffects(subject: AssistantsSubject): void {
  it('inserts an effect once per key, and reads it by key and by request', async () => {
    const request = requestOf(6, 'effects', 5);
    const effect = effectOf(1, request.id, `reply:${request.id}`);
    const read = await subject().store.transaction(async (tx) => {
      await ensurePersonal(tx);
      await tx.assistantRequests.write.insert(request);
      return {
        first: await tx.assistantEffects.write.insert(effect),
        again: await tx.assistantEffects.write.insert({ ...effect, id: uid(base + 0x8f) }),
        byKey: await tx.assistantEffects.read.byKey(uid(base), effect.idempotencyKey),
        missing: await tx.assistantEffects.read.byKey(uid(base), 'reply:none'),
        forRequests: await tx.assistantEffects.read.forRequests([request.id]),
        none: await tx.assistantEffects.read.forRequests([]),
      };
    });
    expect([read.first, read.again]).toEqual([true, false]);
    expect(read.byKey).toEqual(effect);
    expect(read.missing).toBeNull();
    expect(read.forRequests).toEqual([effect]);
    expect(read.none).toEqual([]);
  });
}

export function describeStoreAssistants(adapter: string, subject: AssistantsSubject): void {
  describe(`PA-2 store assistant gateways on ${adapter}`, () => {
    describeHarnessAndSettings(adapter, subject);
    describeRequests(subject);
    describeThread(subject);
    describeThreadBound(subject);
    describeEffects(subject);
    describeStoreAssistantReads(subject);
    describeStoreAssistantReminders(subject);
    describeStoreAssistantHolds(subject);
    describeStoreAssistantPairing(subject);
    describeStoreAssistantBudgets(subject);
    describeStoreAssistantAccounts(subject);
  });
}
