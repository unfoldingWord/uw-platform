import { describeConnectorsNotWired } from '@uw/harness/port-contracts/connectors';
import { describeGithubFactsNotWired } from '@uw/harness/port-contracts/github-facts';
import { describeGrantsNotWired } from '@uw/harness/port-contracts/grants';
import { describeModelEngineNotWired } from '@uw/harness/port-contracts/model-engine';
import { describeStoreNotWired } from '@uw/harness/port-contracts/store';
import { connectorsNotWired } from './connectors.not-wired.ts';
import { githubFactsNotWired } from './github-facts.not-wired.ts';
import { grantsNotWired } from './grants.not-wired.ts';
import { modelEngineNotWired } from './model-engine.not-wired.ts';
import { storeNotWired } from './store.not-wired.ts';

describeStoreNotWired('uw-app with no database', storeNotWired);
describeGrantsNotWired('uw-app with no database', grantsNotWired);
describeGithubFactsNotWired('uw-app until GH-2', githubFactsNotWired);
describeConnectorsNotWired('uw-app until GH-6', connectorsNotWired);
describeModelEngineNotWired('uw-app until HE-2', modelEngineNotWired);
