import { expect, it } from 'vitest';
import { assistantIdentityOf, identitySchema, type NewHarnessEvent } from '@uw/contracts';
import type {
  AssistantBudgetRow,
  AssistantRequestRow,
  Delegation,
  StoreTransaction,
} from '../ports.ts';
import {
  assistantsBase as base,
  ensurePersonal,
  person,
  type AssistantsSubject,
} from './store-assistant-fixtures.ts';
import { at, hour, uid } from './store-gateway-fixtures.ts';

const budgetBase = base + 0x700;
const assistant = identitySchema.parse(assistantIdentityOf(person));

function budgetOf(monthlyMinor: number): AssistantBudgetRow {
  return { harnessId: uid(base), personId: person, monthlyMinor, setBy: person, setAt: at };
}

function assistOf(n: number, expiresAt: Date): Delegation {
  return {
    id: uid(budgetBase + n),
    personId: person,
    persona: assistant,
    harnessId: uid(base),
    capability: 'assist',
    maxTier: null,
    grantedAt: at,
    expiresAt,
    revokedAt: null,
    lapsedAt: null,
    supersedes: null,
  };
}

function turnEvent(n: number, name: string, evidence: NewHarnessEvent['evidence'], when: Date) {
  const event: NewHarnessEvent = {
    eventId: uid(budgetBase + 0x40 + n),
    harnessId: uid(base),
    itemId: null,
    name: name as NewHarnessEvent['name'],
    at: when.toISOString(),
    actor: assistant,
    evidence,
    traceId: uid(budgetBase + 0x3f),
    requestId: null,
  };
  return event;
}

function started(n: number, when: Date): NewHarnessEvent {
  return turnEvent(
    n,
    'assistant_turn_started',
    {
      requestId: uid(budgetBase + 0x20 + n),
      turnId: uid(budgetBase + 0x30 + n),
      attemptId: uid(budgetBase + 0x38 + n),
      delegationId: uid(budgetBase + 1),
      personaVersion: 1,
    },
    when,
  );
}

function finished(n: number, costMicros: number | null, when: Date): NewHarnessEvent {
  return turnEvent(
    n + 0x10,
    'assistant_turn_finished',
    {
      requestId: uid(budgetBase + 0x20 + n),
      turnId: uid(budgetBase + 0x30 + n),
      outcome: 'ended',
      turns: 1,
      inputTokens: 10,
      outputTokens: 2,
      costMicros,
      tools: [],
    },
    when,
  );
}

function describeBudgetRows(subject: AssistantsSubject): void {
  it('PA-16 puts, replaces and removes one assistant budget', async () => {
    const read = await subject().store.transaction(async (tx) => {
      await ensurePersonal(tx);
      await tx.assistantBudgets.write.put(budgetOf(5000));
      const first = await tx.assistantBudgets.read.of(uid(base));
      await tx.assistantBudgets.write.put(budgetOf(700));
      const second = await tx.assistantBudgets.read.of(uid(base));
      await tx.assistantBudgets.write.remove(uid(base));
      return { first, second, gone: await tx.assistantBudgets.read.of(uid(base)) };
    });
    expect(read).toEqual({ first: budgetOf(5000), second: budgetOf(700), gone: null });
  });

  it('PA-16 counts an assistant in the pool only while its assist delegation is live', async () => {
    const when = new Date(at.getTime() + 1000 * hour);
    const read = await subject().store.transaction(async (tx) => {
      await ensurePersonal(tx);
      const noSpend = new Date(at.getTime() + 100_000 * hour);
      const before = await tx.assistantBudgets.read.pool(when, noSpend);
      await tx.delegations.write.insert(assistOf(1, new Date(when.getTime() + hour)), uid(1));
      const live = await tx.assistantBudgets.read.pool(when, noSpend);
      await tx.assistantBudgets.write.put(budgetOf(5000));
      const overridden = await tx.assistantBudgets.read.pool(when, noSpend);
      const later = new Date(when.getTime() + 2 * hour);
      const expired = await tx.assistantBudgets.read.pool(later, noSpend);
      await tx.assistantBudgets.write.remove(uid(base));
      return { before, live, overridden, expired };
    });
    const { before } = read;
    expect(read.live).toEqual({ ...before, enabled: before.enabled + 1 });
    expect(read.overridden).toEqual({
      enabled: before.enabled + 1,
      overridden: before.overridden + 1,
      overriddenMinor: before.overriddenMinor + 5000,
    });
    expect(read.expired.enabled).toBe(before.enabled);
  });
}

function describePoolMembers(subject: AssistantsSubject): void {
  it('PA-16 keeps an assistant that spent this month in the pool after it is turned off', async () => {
    const when = new Date(at.getTime() + 3000 * hour);
    const read = await subject().store.transaction(async (tx) => {
      await ensurePersonal(tx);
      const noSpend = new Date(at.getTime() + 100_000 * hour);
      const before = await tx.assistantBudgets.read.pool(when, noSpend);
      await tx.delegations.write.insert(assistOf(2, new Date(when.getTime() + hour)), uid(1));
      await tx.harnessEvents.write.append([
        started(9, new Date(when.getTime() + 0.5 * hour)),
        finished(9, 1_000, new Date(when.getTime() + 0.6 * hour)),
      ]);
      const later = new Date(when.getTime() + 2 * hour);
      const spentThisMonth = await tx.assistantBudgets.read.pool(later, when);
      const nextMonth = await tx.assistantBudgets.read.pool(later, noSpend);
      return { before, spentThisMonth, nextMonth };
    });
    expect(read.spentThisMonth.enabled).toBe(read.before.enabled + 1);
    expect(read.nextMonth.enabled).toBe(read.before.enabled);
  });
}

async function poolDelta(tx: StoreTransaction, since: Date) {
  return tx.harnessEvents.read.assistantPoolSpend(since);
}

function describePoolReads(subject: AssistantsSubject): void {
  it('PA-16 sums every assistant turn of the month into the pool, open turns apart', async () => {
    const since = new Date(at.getTime() + 2000 * hour);
    const read = await subject().store.transaction(async (tx) => {
      await ensurePersonal(tx);
      const before = await poolDelta(tx, since);
      await tx.harnessEvents.write.append([
        started(1, new Date(since.getTime() + hour)),
        finished(1, 30_000, new Date(since.getTime() + 2 * hour)),
        started(2, new Date(since.getTime() + hour)),
        finished(2, null, new Date(since.getTime() + 2 * hour)),
        started(3, new Date(since.getTime() + 3 * hour)),
        started(4, new Date(since.getTime() - hour)),
      ]);
      return { before, after: await poolDelta(tx, since) };
    });
    expect(read.after).toEqual({
      knownMicros: read.before.knownMicros + 30_000,
      unknownTurns: read.before.unknownTurns + 1,
      openTurns: read.before.openTurns + 1,
    });
  });
}

function describeStaleReads(subject: AssistantsSubject): void {
  it('R11 lists the turns started before an instant that never finished, oldest first', async () => {
    const since = new Date(at.getTime() + 3000 * hour);
    const stale = await subject().store.transaction(async (tx) => {
      await ensurePersonal(tx);
      await tx.harnessEvents.write.append([
        started(5, new Date(since.getTime() + 2 * hour)),
        started(6, new Date(since.getTime() + hour)),
        started(7, new Date(since.getTime() + hour)),
        finished(7, 10, new Date(since.getTime() + 2 * hour)),
        started(8, new Date(since.getTime() + 5 * hour)),
      ]);
      return tx.harnessEvents.read.assistantStaleTurns({
        since,
        startedBefore: new Date(since.getTime() + 4 * hour),
        limit: 10,
      });
    });
    expect(stale.map((turn) => turn.turnId)).toEqual([
      uid(budgetBase + 0x30 + 6),
      uid(budgetBase + 0x30 + 5),
    ]);
    expect(stale[0]).toEqual({
      harnessId: uid(base),
      requestId: uid(budgetBase + 0x20 + 6),
      turnId: uid(budgetBase + 0x30 + 6),
      startedAt: new Date(since.getTime() + hour),
    });
  });

  it('R11 refuses a stale turn read of more than two hundred turns', async () => {
    const query = { since: at, startedBefore: at, limit: 201 };
    await expect(
      subject().store.transaction((tx) => tx.harnessEvents.read.assistantStaleTurns(query)),
    ).rejects.toThrow(RangeError);
  });
}

function waitingRequest(n: number, recordedAt: Date): AssistantRequestRow {
  return {
    id: uid(budgetBase + 0x20 + n),
    harnessId: uid(base),
    personId: person,
    channel: 'zulip_dm',
    externalId: `unstarted-${String(budgetBase + n)}`,
    threadKey: 'dm',
    replyAddress: 'zulip:5005',
    note: 'Waiting',
    untrustedParts: [],
    receivedAt: recordedAt,
    recordedAt,
  };
}

function describeUnstartedReads(subject: AssistantsSubject): void {
  it('PA-17 lists the requests recorded in a window that no turn started or refused', async () => {
    const since = new Date(at.getTime() + 4000 * hour);
    const read = await subject().store.transaction(async (tx) => {
      await ensurePersonal(tx);
      for (const n of [9, 10, 11]) {
        await tx.assistantRequests.write.insert(waitingRequest(n, new Date(since.getTime() + n)));
      }
      await tx.harnessEvents.write.append([started(10, new Date(since.getTime() + hour))]);
      const window = { since, recordedBefore: new Date(since.getTime() + 11), limit: 10 };
      return tx.assistantRequests.read.unstarted(window);
    });
    expect(read).toEqual([uid(budgetBase + 0x20 + 9)]);
  });
}

export function describeStoreAssistantBudgets(subject: AssistantsSubject): void {
  describeUnstartedReads(subject);
  describeBudgetRows(subject);
  describePoolReads(subject);
  describePoolMembers(subject);
  describeStaleReads(subject);
}
