import { beforeAll, describe, expect, it } from 'vitest';
import type { ConnectorRequest } from '@uw/harness';
import type { GitHubAppConfig } from './app-config.ts';
import { fixtureApp } from './testing/app-key.ts';
import {
  mergeOver,
  openGitHub,
  otherHead,
  pullAt,
  request,
  writesOf,
} from './testing/merge-rig.ts';

let app: GitHubAppConfig;

beforeAll(async () => {
  app = await fixtureApp();
});

const refusedFor = (reason: string) => ({ outcome: 'refused', reason });

async function runWith(change: Partial<ConnectorRequest>) {
  const github = openGitHub();
  const outcome = await mergeOver(app, github).run({ ...request, ...change });
  return { outcome, sent: github.requests() };
}

describe('GH-6 the merge connector refuses another repository’s pull request before asking GitHub', () => {
  it.each([
    [
      'a pull request in another repository',
      { pullRequest: { repo: 'unfoldingWord/other', number: 42 } },
    ],
    ['a harness with no repository', { repository: null }],
  ])('refuses %s as repository_mismatch with no request at all', async (_name, change) => {
    const { outcome, sent } = await runWith(change);
    expect(outcome).toEqual(refusedFor('repository_mismatch'));
    expect(sent).toEqual([]);
  });

  it.each([
    ['no pull request', { pullRequest: null }],
    ['no expected head', { expectedHead: null }],
    ['an abbreviated expected head', { expectedHead: 'c0ffee' }],
  ])('refuses %s as head_mismatch with no request at all', async (_name, change) => {
    const { outcome, sent } = await runWith(change);
    expect(outcome).toEqual(refusedFor('head_mismatch'));
    expect(sent).toEqual([]);
  });

  it('matches the repository in any case', async () => {
    const { outcome } = await runWith({ repository: 'UnfoldingWord/UW-Platform' });
    expect(outcome).toMatchObject({ outcome: 'succeeded' });
  });
});

describe('GH-6 the merge connector re-checks the pull request it merges at merge time', () => {
  it.each([
    ['a head in a fork', pullAt({ headRepo: 'someone/uw-platform' }), 'head_repository_mismatch'],
    ['a head in a deleted fork', pullAt({ headRepo: null }), 'head_repository_mismatch'],
    ['a head on another branch', pullAt({ ref: 'feature/board' }), 'head_ref_mismatch'],
    [
      'a merged fork pull request',
      pullAt({ merged: true, headRepo: 'someone/uw-platform' }),
      'head_repository_mismatch',
    ],
    ['a base that moved after the decision', pullAt({ base: otherHead }), 'base_mismatch'],
  ])('refuses %s and merges nothing', async (_name, pull, reason) => {
    const github = openGitHub(pull);
    expect(await mergeOver(app, github).run(request)).toEqual(refusedFor(reason));
    expect(writesOf(github)).toEqual([]);
  });

  it('refuses a pull request retargeted to another base branch at the same commit', async () => {
    const github = openGitHub(pullAt({ baseRef: 'release' }));
    expect(await mergeOver(app, github).run(request)).toEqual(
      refusedFor('base_not_default_branch'),
    );
    expect(writesOf(github)).toEqual([]);
  });

  it('refuses a merge whose decision recorded no base', async () => {
    const github = openGitHub();
    const outcome = await mergeOver(app, github).run({ ...request, expectedBase: null });
    expect(outcome).toEqual(refusedFor('base_mismatch'));
    expect(writesOf(github)).toEqual([]);
  });

  it('answers no outcome for a fork pull request merged at the head', async () => {
    const github = openGitHub(pullAt({ merged: true, headRepo: 'someone/uw-platform' }));
    expect(await mergeOver(app, github).outcomeOf(request)).toBeNull();
  });

  it('answers github_malformed_response for a pull request answer of the wrong shape', async () => {
    const github = openGitHub({ status: 200, body: { id: 1 } });
    expect(await mergeOver(app, github).run(request)).toEqual(
      refusedFor('github_malformed_response'),
    );
    expect(writesOf(github)).toEqual([]);
  });
});

describe('GH-6 the merge connector merges only into the repository’s default branch', () => {
  it.each([
    [
      'a decision on a base that is not the default branch',
      pullAt({ baseRef: 'release' }),
      { expectedBase: { sha: '0'.repeat(40), ref: 'release' } },
    ],
    ['a default branch renamed after the decision', pullAt({ defaultBranch: 'trunk' }), {}],
  ])('refuses %s and merges nothing', async (_name, pull, change) => {
    const github = openGitHub(pull);
    const outcome = await mergeOver(app, github).run({ ...request, ...change });
    expect(outcome).toEqual(refusedFor('base_not_default_branch'));
    expect(writesOf(github)).toEqual([]);
  });

  it('never answers success for a pull request a person merged at the head into another base', async () => {
    const pull = pullAt({ merged: true, baseRef: 'release' });
    const decidedThere = { ...request, expectedBase: { sha: '0'.repeat(40), ref: 'release' } };
    for (const asked of [request, decidedThere]) {
      const github = openGitHub(pull);
      expect(await mergeOver(app, github).outcomeOf(asked)).toBeNull();
      expect(await mergeOver(app, github).run(asked)).toMatchObject({ outcome: 'refused' });
      expect(writesOf(github)).toEqual([]);
    }
  });

  it('answers no outcome for a merge into the default branch when the decision named another base', async () => {
    const github = openGitHub(pullAt({ merged: true }));
    const elsewhere = { ...request, expectedBase: { sha: '0'.repeat(40), ref: 'release' } };
    expect(await mergeOver(app, github).outcomeOf(elsewhere)).toBeNull();
  });
});

describe('the merge connector holds one token per run, scoped to the one repository', () => {
  it('mints one token for the read, the merge and the tag, for the repository with contents write', async () => {
    const github = openGitHub();
    await mergeOver(app, github).run(request);
    const mints = github.requests().filter((sent) => sent.path.endsWith('/access_tokens'));
    expect(mints.map((sent) => sent.body)).toEqual([
      {
        repositories: ['uw-platform'],
        permissions: { contents: 'write', pull_requests: 'read', metadata: 'read' },
      },
    ]);
  });
});
