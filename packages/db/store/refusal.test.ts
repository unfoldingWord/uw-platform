import { describe, expect, it } from 'vitest';
import { refusing, StoreRefusedError } from './refusal.ts';

function databaseError(code: string): Error {
  return Object.assign(new Error('violates'), {
    code,
    constraint_name: 'a_check',
    table_name: 'a_table',
  });
}

describe('DX-3 refusing', () => {
  it.each(['23514', '23505', 'P0001'])('names a %s database error as a refusal', async (code) => {
    const cause = databaseError(code);
    const thrown = await refusing(() => Promise.reject(cause)).catch((error: unknown) => error);
    expect(thrown).toBeInstanceOf(StoreRefusedError);
    expect(thrown).toMatchObject({ code, constraint: 'a_check', table: 'a_table', cause });
  });

  it('lets any other database error and any other failure through unchanged', async () => {
    const lockTimeout = databaseError('55P03');
    const plain = new Error('plain');
    await expect(refusing(() => Promise.reject(lockTimeout))).rejects.toBe(lockTimeout);
    await expect(refusing(() => Promise.reject(plain))).rejects.toBe(plain);
    await expect(refusing(async () => 7)).resolves.toBe(7);
  });
});
