import { notWiredCall, type Store } from '@uw/harness';

export const storeNotWired: Store = {
  transaction: () => notWiredCall('store', 'transaction'),
  appliedMigrations: () => notWiredCall('store', 'appliedMigrations'),
};
