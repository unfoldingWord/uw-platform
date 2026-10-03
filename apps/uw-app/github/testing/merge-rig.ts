import type { ConnectorRequest } from '@uw/harness';
import restPull from '../fixtures/rest-pull.json' with { type: 'json' };
import type { GitHubAppConfig } from '../app-config.ts';
import { mergeHandler } from '../merge.ts';
import { fixtureTransport } from './app-key.ts';
import { fixtureGitHub, type FixtureGitHub, type FixtureReply } from './fixture-github.ts';

export const itemId = 'b1000000-0000-4000-8000-000000000042';
const head = `c0ffee${'0'.repeat(34)}`;
export const otherHead = `beef${'0'.repeat(36)}`;
const base = '0'.repeat(40);
export const mergeSha = `ace${'0'.repeat(37)}`;
export const tagName = `harness/${itemId}`;

const repo = '/repos/unfoldingWord/uw-platform';
export const paths = {
  pull: `${repo}/pulls/42`,
  merge: `${repo}/pulls/42/merge`,
  refs: `${repo}/git/refs`,
  tag: `${repo}/git/ref/tags/${tagName}`,
};

export const request: ConnectorRequest = {
  connector: 'merge',
  harnessId: 'b1000000-0000-4000-8000-000000000001',
  itemId,
  traceId: 'b1000000-0000-4000-8000-000000000003',
  pullRequest: { repo: 'unfoldingWord/uw-platform', number: 42 },
  expectedHead: head,
  expectedBase: { sha: base, ref: 'main' },
  repository: 'unfoldingWord/uw-platform',
  title: 'Show the board',
  overrideReason: 'reviewer is away',
};

type PullChange = {
  readonly head?: string;
  readonly ref?: string;
  readonly headRepo?: string | null;
  readonly base?: string;
  readonly baseRef?: string;
  readonly state?: 'open' | 'closed';
  readonly merged?: boolean;
  readonly mergeSha?: string | null;
};

function headRepositoryOf(headRepo: string | null | undefined) {
  if (headRepo === undefined) return restPull.head.repo;
  return headRepo === null ? null : { ...restPull.head.repo, full_name: headRepo };
}

function mergeCommitOf(change: PullChange): string | null {
  if (change.merged !== true) return null;
  return change.mergeSha === undefined ? mergeSha : change.mergeSha;
}

function sidesOf(change: PullChange) {
  return {
    head: {
      ...restPull.head,
      sha: change.head ?? head,
      ref: change.ref ?? tagName,
      repo: headRepositoryOf(change.headRepo),
    },
    base: { ...restPull.base, sha: change.base ?? base, ref: change.baseRef ?? 'main' },
  };
}

export function pullAt(change: PullChange = {}): FixtureReply {
  const merged = change.merged ?? false;
  return {
    status: 200,
    body: {
      ...restPull,
      number: 42,
      state: change.state ?? (merged ? 'closed' : 'open'),
      merged,
      merged_at: merged ? '2026-10-02T12:00:00Z' : null,
      merge_commit_sha: mergeCommitOf(change),
      ...sidesOf(change),
    },
  };
}

const merged200: FixtureReply = { status: 200, body: { sha: mergeSha, merged: true } };
const tagged201: FixtureReply = { status: 201, body: { ref: `refs/tags/${tagName}` } };

export function openGitHub(pull: FixtureReply | FixtureReply[] = pullAt()): FixtureGitHub {
  const github = fixtureGitHub();
  github.on('GET', paths.pull, pull);
  github.on('PUT', paths.merge, merged200);
  github.on('POST', paths.refs, tagged201);
  return github;
}

export function mergeOver(app: GitHubAppConfig, github: FixtureGitHub) {
  return mergeHandler({ app, transport: fixtureTransport(github) });
}

export function routesOf(github: FixtureGitHub): string[] {
  return github
    .requests()
    .filter((sent) => !sent.path.endsWith('/access_tokens'))
    .map((sent) => `${sent.method} ${sent.path}`);
}

export function writesOf(github: FixtureGitHub): string[] {
  return routesOf(github).filter((route) => !route.startsWith('GET '));
}
