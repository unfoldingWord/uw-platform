import { describeDirectMessagesNotWired } from '@uw/harness/port-contracts/direct-messages';
import { describeGithubFactsNotWired } from '@uw/harness/port-contracts/github-facts';
import { describeGrantsNotWired } from '@uw/harness/port-contracts/grants';
import { describeHubNotWired } from '@uw/harness/port-contracts/hub';
import { describeModelEngineNotWired } from '@uw/harness/port-contracts/model-engine';
import { describeNotifierNotWired } from '@uw/harness/port-contracts/notifier';
import { describeRunsNotWired } from '@uw/harness/port-contracts/runs';
import { describeStoreNotWired } from '@uw/harness/port-contracts/store';
import { directMessagesNotWired } from './direct-messages.not-wired.ts';
import { githubFactsNotWired } from './github-facts.not-wired.ts';
import { grantsNotWired } from './grants.not-wired.ts';
import { hubNotWired } from './hub.not-wired.ts';
import { modelEngineNotWired } from './model-engine.not-wired.ts';
import { notifierNotWired } from './notifier.not-wired.ts';
import { runsNotWired } from './runs.not-wired.ts';
import { storeNotWired } from './store.not-wired.ts';
import { workspaceNotWired } from './workspace.not-wired.ts';
import { describeWorkspaceNotWired } from '@uw/harness/port-contracts/workspace';
import { describePageAppendsNotWired } from '@uw/harness/port-contracts/page-appends';
import { pageAppendsNotWired } from './page-appends.not-wired.ts';

describeStoreNotWired('uw-platform with no database', storeNotWired);
describeGrantsNotWired('uw-platform with no database', grantsNotWired);
describeGithubFactsNotWired('uw-platform with no database', githubFactsNotWired);
describeModelEngineNotWired('uw-platform kernels built without a model', modelEngineNotWired);
describeHubNotWired('uw-platform until WB-3', hubNotWired);
describeNotifierNotWired('uw-platform until NT-1', notifierNotWired);
describeRunsNotWired('uw-platform until HE-1', runsNotWired);
describeDirectMessagesNotWired(
  'uw-platform until the Zulip direct message slice',
  directMessagesNotWired,
);
describeWorkspaceNotWired('uw-platform with no Google Workspace key', workspaceNotWired);
describePageAppendsNotWired('uw-platform with no database', pageAppendsNotWired);
