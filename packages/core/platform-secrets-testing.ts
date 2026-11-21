import type { StoreSecret } from './platform-secrets.ts';

export type TestStoreSecret = StoreSecret & {
  reads(): number;
  rotate(value: string): void;
};

export function storedSecret(initial: string): TestStoreSecret {
  const state = { value: initial, reads: 0 };
  return {
    get: async () => {
      state.reads += 1;
      return state.value;
    },
    reads: () => state.reads,
    rotate: (value) => {
      state.value = value;
    },
  };
}

export function unreadableSecret(): TestStoreSecret {
  const state = { reads: 0 };
  return {
    get: async () => {
      state.reads += 1;
      throw new Error('secret not found in the Secrets Store');
    },
    reads: () => state.reads,
    rotate: () => undefined,
  };
}
