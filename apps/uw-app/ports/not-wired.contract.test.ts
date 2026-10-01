import { describeStoreNotWired } from '@uw/harness/port-contracts/store';
import { storeNotWired } from './store.not-wired.ts';

describeStoreNotWired('uw-app with no database', storeNotWired);
