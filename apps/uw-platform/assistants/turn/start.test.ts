import { describe, expect, it } from 'vitest';
import type { AssistantTurnBinding } from '../../env.ts';
import { turnStarterOf } from './start.ts';

const start = {
  requestId: '00000000-0000-4000-8000-0000000017a1',
  traceId: '00000000-0000-4000-8000-0000000017a2',
};

function binding(failure: Error | null): AssistantTurnBinding & { readonly ids: string[] } {
  const ids: string[] = [];
  return {
    ids,
    create: async ({ id }) => {
      if (failure !== null) throw failure;
      if (ids.includes(id)) throw new Error(`instance.already_exists ${id}`);
      ids.push(id);
      return {};
    },
  };
}

describe('PA-17 a recorded request starts one AssistantTurn named by its request id', () => {
  it('starts the instance once and answers already_started for the same request again', async () => {
    const bound = binding(null);
    const startTurn = turnStarterOf(bound);
    expect(await startTurn(start)).toBe('started');
    expect(await startTurn(start)).toBe('already_started');
    expect(bound.ids).toEqual([start.requestId]);
  });

  it('answers not_wired without a binding and rethrows any other failure', async () => {
    expect(await turnStarterOf(undefined)(start)).toBe('not_wired');
    const failing = turnStarterOf(binding(new Error('network lost')));
    await expect(failing(start)).rejects.toThrow('network lost');
  });
});
