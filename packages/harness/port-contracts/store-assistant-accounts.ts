import { expect, it } from 'vitest';
import type { AssistantAccountRow, StoreTransaction } from '../ports.ts';
import {
  assistantsBase as base,
  ensurePersonal,
  person,
  type AssistantsSubject,
} from './store-assistant-fixtures.ts';
import { at, hour, uid } from './store-gateway-fixtures.ts';

class RolledBack<T> extends Error {
  readonly value: T;

  constructor(value: T) {
    super('rolled back on purpose');
    this.value = value;
  }
}

async function rolledBack<T>(
  subject: AssistantsSubject,
  work: (tx: StoreTransaction) => Promise<T>,
): Promise<T> {
  try {
    await subject().store.transaction(async (tx) => {
      throw new RolledBack(await work(tx));
    });
  } catch (error) {
    if (error instanceof RolledBack) return error.value as T;
    throw error;
  }
  throw new Error('the transaction was meant to roll back');
}

function accountOf(change: Partial<AssistantAccountRow> = {}): AssistantAccountRow {
  return {
    harnessId: uid(base),
    personId: person,
    name: 'barnabas-contract',
    jdId: '10.97',
    status: 'enabled',
    disabledAt: null,
    deletedAt: null,
    version: 1,
    createdAt: at,
    updatedAt: at,
    ...change,
  };
}

function describeAccountWrites(subject: AssistantsSubject): void {
  it('PA-14 inserts an account and updates it only at the version it read', async () => {
    const read = await rolledBack(subject, async (tx) => {
      await ensurePersonal(tx);
      await tx.assistantAccounts.write.insert(accountOf());
      const byPerson = await tx.assistantAccounts.read.byPerson(person);
      const off = accountOf({ status: 'disabled', disabledAt: at, version: 2 });
      const stale = await tx.assistantAccounts.write.update(off, 2);
      const fresh = await tx.assistantAccounts.write.update(off, 1);
      return { byPerson, stale, fresh, now: await tx.assistantAccounts.read.byHarness(uid(base)) };
    });
    expect(read.byPerson).toEqual(accountOf());
    expect(read.stale).toBe(false);
    expect(read.fresh).toBe(true);
    expect(read.now).toEqual(accountOf({ status: 'disabled', disabledAt: at, version: 2 }));
  });
}

function describeAccountReads(subject: AssistantsSubject): void {
  it('PA-14 knows the JD ids and the names held, and lets a deleted one go', async () => {
    const read = await rolledBack(subject, async (tx) => {
      await ensurePersonal(tx);
      await tx.assistantAccounts.write.insert(accountOf());
      const held = {
        ids: await tx.assistantAccounts.read.takenJdIds(),
        name: await tx.assistantAccounts.read.nameHolder('barnabas-contract'),
      };
      const gone = accountOf({
        status: 'deleted',
        jdId: null,
        disabledAt: at,
        deletedAt: at,
        version: 2,
      });
      await tx.assistantAccounts.write.update(gone, 1);
      return {
        held,
        ids: await tx.assistantAccounts.read.takenJdIds(),
        name: await tx.assistantAccounts.read.nameHolder('barnabas-contract'),
      };
    });
    expect(read.held.ids).toContain('10.97');
    expect(read.held.name).toBe(uid(base));
    expect(read.ids).not.toContain('10.97');
    expect(read.name).toBeNull();
  });

  it('PA-14 lists the accounts turned off at or before a time, oldest first', async () => {
    const read = await rolledBack(subject, async (tx) => {
      await ensurePersonal(tx);
      const disabledAt = new Date(at.getTime() + hour);
      await tx.assistantAccounts.write.insert(accountOf({ status: 'disabled', disabledAt }));
      return {
        before: await tx.assistantAccounts.read.disabledBefore(at, 10),
        after: await tx.assistantAccounts.read.disabledBefore(disabledAt, 10),
      };
    });
    expect(read.before.map((row) => row.harnessId)).not.toContain(uid(base));
    expect(read.after.map((row) => row.harnessId)).toContain(uid(base));
  });
}

function describeLeavers(subject: AssistantsSubject): void {
  it('PA-20 lists no enabled assistant whose person is still active, and refuses a wild limit', async () => {
    const read = await rolledBack(subject, async (tx) => {
      await ensurePersonal(tx);
      await tx.assistantAccounts.write.insert(accountOf());
      return tx.assistantAccounts.read.leavers(10);
    });
    expect(read.map((row) => row.harnessId)).not.toContain(uid(base));
    await expect(rolledBack(subject, (tx) => tx.assistantAccounts.read.leavers(0))).rejects.toThrow(
      RangeError,
    );
  });
}

export function describeStoreAssistantAccounts(subject: AssistantsSubject): void {
  describeAccountWrites(subject);
  describeAccountReads(subject);
  describeLeavers(subject);
}
