import { beforeAll } from 'vitest';
import type { EffectConnector } from '@uw/harness';
import { contractRequest, describeConnectorsContract } from '@uw/harness/port-contracts/connectors';
import restPull from '../github/fixtures/rest-pull.json' with { type: 'json' };
import type { GitHubAppConfig } from '../github/app-config.ts';
import { fixtureApp, fixtureTransport } from '../github/testing/app-key.ts';
import { fixtureGitHub, type FixtureGitHub } from '../github/testing/fixture-github.ts';
import { platformConnectors } from './connectors.ts';

const repo = `/repos/${contractRequest.pullRequest.repo}`;
const pullPath = `${repo}/pulls/${contractRequest.pullRequest.number}`;
const mergePath = `${pullPath}/merge`;
const reviewsPath = `${pullPath}/reviews`;
const mergeSha = `ace${'0'.repeat(37)}`;

let app: GitHubAppConfig;

beforeAll(async () => {
  app = await fixtureApp();
});

function pullReply(merged: boolean) {
  return {
    status: 200,
    body: {
      ...restPull,
      state: merged ? 'closed' : 'open',
      merged,
      merge_commit_sha: merged ? mergeSha : null,
      head: { ...restPull.head, sha: contractRequest.expectedHead },
      base: { ...restPull.base, ...contractRequest.expectedBase },
    },
  };
}

function openPullRequest(): FixtureGitHub {
  const github = fixtureGitHub();
  github.on('GET', pullPath, pullReply(false));
  github.on('PUT', mergePath, { status: 200, body: { sha: mergeSha, merged: true } });
  github.on('POST', `${repo}/git/refs`, { status: 201, body: {} });
  const send: typeof fetch = async (input, init) => {
    const answer = await github.fetch(input, init);
    const merging = (init?.method ?? 'GET').toUpperCase() === 'PUT';
    if (merging && answer.ok) github.on('GET', pullPath, pullReply(true));
    return answer;
  };
  return { ...github, fetch: send };
}

function refuseMerge(github: FixtureGitHub) {
  return async (connector: EffectConnector, reason: string) => {
    if (connector !== 'merge' || reason !== 'head_mismatch') {
      throw new Error(`the fixture GitHub cannot refuse ${connector} with ${reason}`);
    }
    github.on('PUT', mergePath, [
      { status: 409, body: { message: 'Head branch was modified' } },
      { status: 200, body: { sha: mergeSha, merged: true } },
    ]);
  };
}

describeConnectorsContract(
  'the platform connectors over a fixture GitHub',
  async () => {
    const github = openPullRequest();
    github.on('POST', reviewsPath, { status: 200, body: { id: 9400000001 } });
    const transport = fixtureTransport(github);
    const apps = new Map([['uw-reviewer', app]]);
    return {
      connectors: platformConnectors({ app, transport }, { apps, transport }),
      refuseNext: refuseMerge(github),
      refuseNextReview: async (reason) => {
        if (reason !== 'head_moved') {
          throw new Error(`the fixture GitHub cannot refuse a review with ${reason}`);
        }
        github.on('POST', reviewsPath, [
          { status: 422, body: { message: 'commit_id is not part of the pull request' } },
          { status: 200, body: { id: 9400000002 } },
        ]);
      },
    };
  },
  'scripted',
);

describeConnectorsContract(
  'the platform connectors with no Reviewer App, as every kernel but the run host holds them',
  async () => {
    const github = openPullRequest();
    return {
      connectors: platformConnectors({ app, transport: fixtureTransport(github) }, null),
      refuseNext: refuseMerge(github),
      refuseNextReview: () => Promise.reject(new Error('this subject holds no review write')),
    };
  },
  'not_wired',
);
