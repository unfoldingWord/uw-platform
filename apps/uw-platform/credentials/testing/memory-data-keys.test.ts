import { describeDataKeysContract } from './data-keys-contract.ts';
import { memoryDataKeys } from './memory-data-keys.ts';

describeDataKeysContract('the in-memory test adapter', async () => {
  const keys = await memoryDataKeys();
  return { keys, loseTheService: () => keys.failNext('key_service_unavailable') };
});
