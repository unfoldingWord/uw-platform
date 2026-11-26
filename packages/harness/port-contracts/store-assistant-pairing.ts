import { expect, it } from 'vitest';
import type {
  AssistantBindingRow,
  AssistantPairingCodeRow,
  AssistantRequestRow,
} from '../ports.ts';
import {
  assistantsBase as base,
  ensurePersonal,
  person,
  type AssistantsSubject,
} from './store-assistant-fixtures.ts';
import { at, hour, uid } from './store-gateway-fixtures.ts';

const pairingBase = base + 0x700;

function bindingOf(address: string): AssistantBindingRow {
  return {
    harnessId: uid(base),
    personId: person,
    channel: 'zulip_dm',
    address,
    via: 'email_match',
    boundAt: at,
  };
}

function codeOf(attempts: number): AssistantPairingCodeRow {
  return {
    harnessId: uid(base),
    personId: person,
    channel: 'zulip_dm',
    codeDigest: 'b'.repeat(64),
    expiresAt: new Date(at.getTime() + hour),
    attempts,
    createdAt: at,
  };
}

function requestOf(n: number, recordedAt: Date): AssistantRequestRow {
  return {
    id: uid(pairingBase + n),
    harnessId: uid(base),
    personId: person,
    channel: 'zulip_dm',
    externalId: `pairing-${String(pairingBase + n)}`,
    threadKey: 'dm',
    replyAddress: 'zulip:5005',
    note: 'Hello',
    untrustedParts: [],
    receivedAt: recordedAt,
    recordedAt,
  };
}

function describeBindings(subject: AssistantsSubject): void {
  it('puts a binding, replaces it on the same channel, and finds it by address', async () => {
    const read = await subject().store.transaction(async (tx) => {
      await ensurePersonal(tx);
      await tx.assistantBindings.write.put(bindingOf('zulip:7007'));
      await tx.assistantBindings.write.put({ ...bindingOf('zulip:7008'), via: 'pairing_code' });
      return {
        of: await tx.assistantBindings.read.of(uid(base), 'zulip_dm'),
        email: await tx.assistantBindings.read.of(uid(base), 'email'),
        byAddress: await tx.assistantBindings.read.byAddress('zulip_dm', 'zulip:7008'),
        old: await tx.assistantBindings.read.byAddress('zulip_dm', 'zulip:7007'),
      };
    });
    const replaced = { ...bindingOf('zulip:7008'), via: 'pairing_code' };
    expect(read).toEqual({ of: replaced, email: null, byAddress: replaced, old: null });
  });
}

function describeCodes(subject: AssistantsSubject): void {
  it('puts a pairing code, counts its attempts and removes it', async () => {
    const read = await subject().store.transaction(async (tx) => {
      await ensurePersonal(tx);
      await tx.assistantPairingCodes.write.put(codeOf(4));
      await tx.assistantPairingCodes.write.put(codeOf(0));
      const fresh = await tx.assistantPairingCodes.read.of(uid(base), 'zulip_dm');
      await tx.assistantPairingCodes.write.attempted(uid(base), 'zulip_dm', 2);
      const tried = await tx.assistantPairingCodes.read.of(uid(base), 'zulip_dm');
      await tx.assistantPairingCodes.write.remove(uid(base), 'zulip_dm');
      return { fresh, tried, gone: await tx.assistantPairingCodes.read.of(uid(base), 'zulip_dm') };
    });
    expect(read).toEqual({ fresh: codeOf(0), tried: codeOf(2), gone: null });
  });
}

function describeRequestCount(subject: AssistantsSubject): void {
  it('counts the requests an assistant recorded since an instant', async () => {
    const counted = await subject().store.transaction(async (tx) => {
      await ensurePersonal(tx);
      const since = new Date(at.getTime() + 9002 * hour);
      const before = await tx.assistantRequests.read.countSince(uid(base), since);
      for (const n of [1, 2, 3]) {
        const recordedAt = new Date(at.getTime() + (9000 + n) * hour);
        await tx.assistantRequests.write.insert(requestOf(n, recordedAt));
      }
      return {
        added: (await tx.assistantRequests.read.countSince(uid(base), since)) - before,
        other: await tx.assistantRequests.read.countSince(uid(pairingBase + 0x80), at),
      };
    });
    expect(counted.added).toBe(2);
    expect(counted.other).toBe(0);
  });
}

export function describeStoreAssistantPairing(subject: AssistantsSubject): void {
  describeBindings(subject);
  describeCodes(subject);
  describeRequestCount(subject);
}
