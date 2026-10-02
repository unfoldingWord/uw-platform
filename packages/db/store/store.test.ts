import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeEmbeddedTemplate } from '../embedded.ts';
import { people } from '../schema.ts';
import { databaseTargets, type DatabaseTarget, type OpenedDatabase } from '../test-targets.ts';
import { createDrizzleStore, executorOf } from './store.ts';
import type { DrizzleTransaction } from './types.ts';

afterAll(closeEmbeddedTemplate);

const email = 'rollback@fixture.unfoldingword.org';

async function writeThenFail(opened: OpenedDatabase): Promise<void> {
  await createDrizzleStore(opened.db).transaction(async (tx) => {
    await executorOf(tx)
      .insert(people)
      .values({ email, displayName: 'Rollback', status: 'active' });
    throw new Error('after the write');
  });
}

async function countByEmail(opened: OpenedDatabase, address: string): Promise<number> {
  return (await opened.db.select().from(people).where(eq(people.email, address))).length;
}

function describeTarget(target: DatabaseTarget): void {
  let opened: OpenedDatabase;
  beforeAll(async () => {
    opened = await target.open();
  });
  afterAll(() => opened.close());

  it('rolls back a write when the work throws', async () => {
    await expect(writeThenFail(opened)).rejects.toThrow('after the write');
    expect(await countByEmail(opened, email)).toBe(0);
  });

  it('commits a write when the work returns', async () => {
    const committed = 'commit@fixture.unfoldingword.org';
    await createDrizzleStore(opened.db).transaction(async (tx) => {
      await executorOf(tx)
        .insert(people)
        .values({ email: committed, displayName: 'Commit', status: 'active' });
    });
    expect(await countByEmail(opened, committed)).toBe(1);
  });
}

describe.each(databaseTargets)('DX-2 the Drizzle store on the $name database', describeTarget);

function untouched<T extends object>(): T {
  return new Proxy<T>(Object.create(null), {});
}

describe('DX-2 executorOf', () => {
  it('refuses a transaction the Drizzle store did not open', () => {
    const foreign: DrizzleTransaction = {
      lock: async () => undefined,
      harnesses: untouched(),
      harnessStages: untouched(),
      harnessItems: untouched(),
      pages: untouched(),
    };
    expect(() => executorOf(foreign)).toThrow('not a transaction of the Drizzle store');
  });
});
