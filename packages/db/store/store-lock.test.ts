import { describe, expect, it } from 'vitest';
import { createClient } from '../client.ts';
import { createMigratedDatabase, testServer } from '../test-database.ts';
import { createDrizzleStore, type DrizzleStore } from './store.ts';

function pause(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function race(first: DrizzleStore, second: DrizzleStore): Promise<string[]> {
  const order: string[] = [];
  let signal: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    signal = resolve;
  });
  const firstRun = first.transaction(async (tx) => {
    await tx.lock('race');
    signal();
    await pause(150);
    order.push('first finished');
  });
  await held;
  const secondRun = second.transaction(async (tx) => {
    await tx.lock('race');
    order.push('second locked');
  });
  await Promise.all([firstRun, secondRun]);
  return order;
}

describe.skipIf(!testServer)('DX-6 two connections serialise on one store lock', () => {
  it('holds the second transaction until the first commits', async () => {
    const database = await createMigratedDatabase(testServer ?? '');
    const one = createClient(database.connectionString);
    const two = createClient(database.connectionString);
    try {
      expect(await race(createDrizzleStore(one), createDrizzleStore(two))).toEqual([
        'first finished',
        'second locked',
      ]);
    } finally {
      await one.$client.end();
      await two.$client.end();
      await database.drop();
    }
  });
});
