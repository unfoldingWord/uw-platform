import { describeGrantsNotWired } from '@uw/harness/port-contracts/grants';
import { describeStoreNotWired } from '@uw/harness/port-contracts/store';
import { grantsNotWired } from './grants.not-wired.ts';
import { storeNotWired } from './store.not-wired.ts';

describeStoreNotWired('uw-app with no database', storeNotWired);
describeGrantsNotWired('uw-app with no database', grantsNotWired);
