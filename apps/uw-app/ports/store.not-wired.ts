import { notWiredCall, type Store } from '@uw/harness';

export const storeNotWired: Store = {
  transaction: () => notWiredCall('store', 'transaction'),
  read: () => notWiredCall('store', 'read'),
  appliedMigrations: () => notWiredCall('store', 'appliedMigrations'),
};
