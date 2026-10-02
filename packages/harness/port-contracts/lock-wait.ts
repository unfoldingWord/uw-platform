import { expect } from 'vitest';

declare function setTimeout(handler: () => void, milliseconds: number): unknown;

export type LockWaiters = () => Promise<number>;

const pollInterval = 20;
const pollDeadline = 3_000;

function pause(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function awaitBlocked(waiters: LockWaiters | undefined): Promise<void> {
  if (!waiters) throw new Error('the subject cannot observe a blocked lock');
  for (let waited = 0; waited < pollDeadline; waited += pollInterval) {
    if ((await waiters()) > 0) return;
    await pause(pollInterval);
  }
  expect.fail('the second transaction was never observed waiting on the lock');
}
