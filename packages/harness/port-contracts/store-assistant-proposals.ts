import { assistantIdentityOf, identitySchema, type NewHarnessEvent } from '@uw/contracts';
import { expect, it } from 'vitest';
import type {
  AssistantEffectRow,
  AssistantRequestRow,
  NewAssistantProposal,
  StoreTransaction,
} from '../ports.ts';
import {
  assistantsBase as base,
  ensurePersonal,
  person,
  type AssistantsSubject,
} from './store-assistant-fixtures.ts';
import { at, hour, uid } from './store-gateway-fixtures.ts';

const proposalBase = base + 0xa00;
const day = 24 * hour;
const human = `human:${person}`;

function requestOf(): AssistantRequestRow {
  return {
    id: uid(proposalBase),
    harnessId: uid(base),
    personId: person,
    channel: 'zulip_dm',
    externalId: `proposals-${String(proposalBase)}`,
    threadKey: 'dm',
    replyAddress: 'zulip:5005',
    note: 'Find a time with Ana',
    untrustedParts: [],
    receivedAt: at,
    recordedAt: at,
  };
}

function proposalOf(n: number, createdInHours = 0): NewAssistantProposal {
  const createdAt = new Date(at.getTime() + createdInHours * hour);
  return {
    id: uid(proposalBase + 0x10 + n),
    harnessId: uid(base),
    personId: person,
    requestId: uid(proposalBase),
    kind: 'email',
    payload: { to: ['ana@example.org'], subject: `Notes ${String(n)}`, body: 'Here they are.' },
    expiresAt: new Date(createdAt.getTime() + 7 * day),
    createdAt,
  };
}

async function seeded(tx: StoreTransaction): Promise<void> {
  await ensurePersonal(tx);
  if ((await tx.assistantRequests.read.byId(uid(proposalBase))) === null) {
    await tx.assistantRequests.write.insert(requestOf());
  }
}

function describeProposalWrites(subject: AssistantsSubject): void {
  it('drafts a proposal pending, with a digest of its payload, and reads it back', async () => {
    const read = await subject().store.transaction(async (tx) => {
      await seeded(tx);
      const inserted = await tx.assistantProposals.write.insert(proposalOf(1));
      return {
        inserted,
        byId: await tx.assistantProposals.read.byId(proposalOf(1).id),
        forRequest: await tx.assistantProposals.read.forRequest(uid(proposalBase)),
        missing: await tx.assistantProposals.read.byId(uid(proposalBase + 0x7f)),
      };
    });
    expect(read.inserted).toEqual({
      ...proposalOf(1),
      digest: read.inserted.digest,
      status: 'pending',
      decidedBy: null,
      decidedAt: null,
      redactedAt: null,
    });
    expect(read.inserted.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(read.byId).toEqual(read.inserted);
    expect(read.forRequest.map((row) => row.id)).toContain(proposalOf(1).id);
    expect(read.missing).toBeNull();
  });
}

function describeProposalDecisions(subject: AssistantsSubject): void {
  it('decides a pending proposal once, and only on the digest it holds', async () => {
    const decidedAt = new Date(at.getTime() + hour);
    const read = await subject().store.transaction(async (tx) => {
      await seeded(tx);
      const { digest } = await tx.assistantProposals.write.insert(proposalOf(2));
      const decision = { id: proposalOf(2).id, decidedBy: human, at: decidedAt } as const;
      return {
        wrongDigest: await tx.assistantProposals.write.decide({
          ...decision,
          status: 'accepted',
          digest: 'b'.repeat(64),
        }),
        accepted: await tx.assistantProposals.write.decide({
          ...decision,
          status: 'accepted',
          digest,
        }),
        again: await tx.assistantProposals.write.decide({
          ...decision,
          status: 'declined',
          digest,
        }),
        row: await tx.assistantProposals.read.byId(proposalOf(2).id),
      };
    });
    expect([read.wrongDigest, read.accepted, read.again]).toEqual([false, true, false]);
    expect(read.row?.status).toBe('accepted');
    expect(read.row?.decidedBy).toBe(human);
    expect(read.row?.decidedAt).toEqual(decidedAt);
  });
}

function describeProposalExpiry(subject: AssistantsSubject): void {
  it('expires only a pending proposal whose week has passed', async () => {
    const read = await subject().store.transaction(async (tx) => {
      await seeded(tx);
      await tx.assistantProposals.write.insert(proposalOf(3, -8 * 24));
      await tx.assistantProposals.write.insert(proposalOf(4));
      const now = at;
      const expiring = await tx.assistantProposals.read.expiring(now, 10);
      return {
        expiring: expiring.map((row) => row.id),
        early: await tx.assistantProposals.write.expire({ id: proposalOf(4).id, at: now }),
        expired: await tx.assistantProposals.write.expire({ id: proposalOf(3).id, at: now }),
        again: await tx.assistantProposals.write.expire({ id: proposalOf(3).id, at: now }),
        row: await tx.assistantProposals.read.byId(proposalOf(3).id),
      };
    });
    expect(read.expiring).toContain(proposalOf(3).id);
    expect(read.expiring).not.toContain(proposalOf(4).id);
    expect([read.early, read.expired, read.again]).toEqual([false, true, false]);
    expect(read.row?.status).toBe('expired');
    expect(read.row?.decidedBy).toBeNull();
  });
}

function describeProposalReads(subject: AssistantsSubject): void {
  it('lists pending proposals first, newest first, and counts those drafted since a time', async () => {
    const read = await subject().store.transaction(async (tx) => {
      await seeded(tx);
      await tx.assistantProposals.write.insert(proposalOf(5, 30));
      await tx.assistantProposals.write.insert(proposalOf(6, 31));
      const { digest } = await tx.assistantProposals.write.insert(proposalOf(9, 40));
      const decided = { id: proposalOf(9).id, decidedBy: human, digest, at } as const;
      await tx.assistantProposals.write.decide({ ...decided, status: 'declined' });
      return {
        recent: await tx.assistantProposals.read.recent(uid(base), 2),
        since: await tx.assistantProposals.read.countSince(
          uid(base),
          new Date(at.getTime() + 29 * hour),
        ),
      };
    });
    expect(read.recent.map((row) => row.id)).toEqual([proposalOf(6).id, proposalOf(5).id]);
    expect(read.since).toBe(3);
  });
}

function describeProposalRedaction(subject: AssistantsSubject): void {
  it('redacts the payload of decided proposals made before a time, never a pending one', async () => {
    const redactedAt = new Date(at.getTime() + 400 * day);
    const read = await subject().store.transaction(async (tx) => {
      await seeded(tx);
      const { digest } = await tx.assistantProposals.write.insert(proposalOf(7, -48));
      await tx.assistantProposals.write.insert(proposalOf(8, -48));
      await tx.assistantProposals.write.decide({
        id: proposalOf(7).id,
        status: 'declined',
        decidedBy: human,
        digest,
        at,
      });
      const query = { harnessId: uid(base), before: at, at: redactedAt, limit: 50 };
      return {
        redacted: await tx.assistantProposals.write.redact(query),
        decided: await tx.assistantProposals.read.byId(proposalOf(7).id),
        pending: await tx.assistantProposals.read.byId(proposalOf(8).id),
      };
    });
    expect(read.redacted).toBeGreaterThanOrEqual(1);
    expect(read.decided?.payload).toEqual({});
    expect(read.decided?.redactedAt).toEqual(redactedAt);
    expect(read.pending?.payload).toEqual(proposalOf(8).payload);
  });

  it('refuses a recent read of more than fifty proposals', async () => {
    await expect(
      subject().store.transaction((tx) => tx.assistantProposals.read.recent(uid(base), 51)),
    ).rejects.toThrow(RangeError);
  });
}

function effectOf(n: number): AssistantEffectRow {
  return {
    id: uid(proposalBase + 0x40 + n),
    harnessId: uid(base),
    requestId: uid(proposalBase),
    kind: 'email_sent',
    idempotencyKey: `proposal:${uid(proposalBase + 0x10 + n)}`,
    payload: { proposalId: uid(proposalBase + 0x10 + n) },
    createdAt: at,
    proposalId: uid(proposalBase + 0x10 + n),
  };
}

function doneOf(n: number): NewHarnessEvent {
  return {
    eventId: uid(proposalBase + 0x60 + n),
    harnessId: uid(base),
    itemId: null,
    name: 'assistant_effect_done',
    at: new Date(at.getTime() + hour).toISOString(),
    actor: identitySchema.parse(assistantIdentityOf(person)),
    evidence: { effectId: effectOf(n).id, kind: 'email_sent' },
    traceId: uid(proposalBase + 0x5f),
    requestId: null,
  };
}

function describeOpenProposalEffects(subject: AssistantsSubject): void {
  it('PA-12 lists an accepted proposal effect started before a time until it is settled', async () => {
    const later = new Date(at.getTime() + 2 * hour);
    const read = await subject().store.transaction(async (tx) => {
      await seeded(tx);
      const { digest } = await tx.assistantProposals.write.insert(proposalOf(10));
      const id = proposalOf(10).id;
      await tx.assistantProposals.write.decide({
        id,
        status: 'accepted',
        decidedBy: human,
        digest,
        at,
      });
      await tx.assistantEffects.write.insert(effectOf(10));
      const ids = async (before: Date) =>
        (await tx.assistantEffects.read.openProposals(before, 200)).map((effect) => effect.id);
      const tooSoon = await ids(at);
      const open = await ids(later);
      const settledBefore = await tx.assistantEffects.read.settled(uid(base), effectOf(10).id);
      await tx.harnessEvents.write.append([doneOf(10)]);
      return {
        tooSoon,
        open,
        settledBefore,
        settledAfter: await tx.assistantEffects.read.settled(uid(base), effectOf(10).id),
        afterwards: await ids(later),
      };
    });
    expect(read.tooSoon).not.toContain(effectOf(10).id);
    expect(read.open).toContain(effectOf(10).id);
    expect(read.settledBefore).toBe(false);
    expect(read.settledAfter).toBe(true);
    expect(read.afterwards).not.toContain(effectOf(10).id);
  });

  it('refuses an open effect read of more than two hundred effects', async () => {
    await expect(
      subject().store.transaction((tx) => tx.assistantEffects.read.openProposals(at, 201)),
    ).rejects.toThrow(RangeError);
  });
}

export function describeStoreAssistantProposals(subject: AssistantsSubject): void {
  describeProposalWrites(subject);
  describeProposalDecisions(subject);
  describeProposalExpiry(subject);
  describeProposalReads(subject);
  describeProposalRedaction(subject);
  describeOpenProposalEffects(subject);
}
