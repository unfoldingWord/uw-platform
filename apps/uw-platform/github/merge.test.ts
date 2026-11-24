import { beforeAll, describe, expect, it } from 'vitest';
import type { GitHubAppConfig } from './app-config.ts';
import { fixtureApp } from './testing/app-key.ts';
import { fixtureGitHub } from './testing/fixture-github.ts';
import {
  itemId,
  mergeOver,
  mergeSha,
  openGitHub,
  otherHead,
  paths,
  pullAt,
  request,
  routesOf,
  tagName,
  writesOf,
} from './testing/merge-rig.ts';

let app: GitHubAppConfig;

beforeAll(async () => {
  app = await fixtureApp();
});

const succeeded = (already: 'true' | 'false', tag = tagName) => ({
  outcome: 'succeeded',
  detail: { mergeSha, tag, already },
});

const refusedFor = (reason: string) => ({ outcome: 'refused', reason });

async function refusalOver(status: number) {
  const github = openGitHub();
  github.on('PUT', paths.merge, { status, body: { message: 'refused' } });
  return { outcome: await mergeOver(app, github).run(request), github };
}

describe('GH-6 the merge connector re-checks the head, squash-merges once per item and head, tags the merge, and answers refusals as outcomes', () => {
  it('squash-merges an open pull request at the expected head with the sha guard, then tags the merge', async () => {
    const github = openGitHub();
    expect(await mergeOver(app, github).run(request)).toEqual(succeeded('false'));
    const sent = github.requests();
    expect(sent.find((entry) => entry.method === 'PUT')?.body).toEqual({
      merge_method: 'squash',
      sha: request.expectedHead,
      commit_title: 'Show the board (#42)',
      commit_message: `Override: reviewer is away\n\nHarness-Item: ${itemId}`,
    });
    expect(sent.find((entry) => entry.path === paths.refs)?.body).toEqual({
      ref: `refs/tags/${tagName}`,
      sha: mergeSha,
    });
    expect(routesOf(github)).toEqual([
      `GET ${paths.pull}`,
      `PUT ${paths.merge}`,
      `POST ${paths.refs}`,
    ]);
  });

  it('refuses head_mismatch without a merge request when the live head is another', async () => {
    const github = openGitHub(pullAt({ head: otherHead }));
    expect(await mergeOver(app, github).run(request)).toEqual(refusedFor('head_mismatch'));
    expect(writesOf(github)).toEqual([]);
  });

  it('refuses head_mismatch and tags nothing when GitHub answers the merge 409 because the head moved', async () => {
    const { outcome, github } = await refusalOver(409);
    expect(outcome).toEqual(refusedFor('head_mismatch'));
    expect(writesOf(github)).toEqual([`PUT ${paths.merge}`]);
  });
});

describe('GH-6 the merge connector answers a GitHub refusal as an outcome, not an exception', () => {
  it.each([
    [405, 'not_mergeable'],
    [403, 'github_forbidden'],
    [422, 'github_unprocessable'],
    [502, 'github_server_error'],
  ])('answers a merge refused %i as %s', async (status, reason) => {
    const { outcome, github } = await refusalOver(status);
    expect(outcome).toEqual(refusedFor(reason));
    expect(writesOf(github)).toEqual([`PUT ${paths.merge}`]);
  });

  it('answers github_unreachable when the merge request throws', async () => {
    const github = openGitHub();
    const throwing: typeof fetch = (input, init) =>
      (init?.method ?? 'GET').toUpperCase() === 'PUT'
        ? Promise.reject(new TypeError('network down'))
        : github.fetch(input, init);
    const connector = mergeOver(app, { ...github, fetch: throwing });
    expect(await connector.run(request)).toEqual(refusedFor('github_unreachable'));
  });

  it('answers a tag GitHub refuses after the merge as a merge with a failed tag', async () => {
    const github = openGitHub();
    github.on('POST', paths.refs, { status: 500, body: { message: 'boom' } });
    expect(await mergeOver(app, github).run(request)).toEqual(succeeded('false', 'failed'));
  });
});

describe('GH-6 the merge connector merges a pull request only once per item and head', () => {
  it('answers an already-merged pull request at the head without merging, ensuring the tag', async () => {
    const github = openGitHub(pullAt({ merged: true }));
    expect(await mergeOver(app, github).run(request)).toEqual(succeeded('true'));
    expect(writesOf(github)).toEqual([`POST ${paths.refs}`]);
  });

  it('merges once when it runs twice for the same item and head', async () => {
    const github = openGitHub([pullAt(), pullAt({ merged: true })]);
    const connector = mergeOver(app, github);
    expect(await connector.run(request)).toEqual(succeeded('false'));
    expect(await mergeOver(app, github).run(request)).toEqual(succeeded('true'));
    expect(writesOf(github).filter((route) => route.startsWith('PUT'))).toHaveLength(1);
  });

  it('answers a merge another run won while this one raced as already merged', async () => {
    const github = openGitHub([pullAt(), pullAt({ merged: true })]);
    github.on('PUT', paths.merge, { status: 405, body: { message: 'not mergeable' } });
    expect(await mergeOver(app, github).run(request)).toEqual(succeeded('true'));
  });

  it('refuses a pull request merged at another head, and one closed unmerged', async () => {
    const elsewhere = openGitHub(pullAt({ merged: true, head: otherHead }));
    expect(await mergeOver(app, elsewhere).run(request)).toEqual(refusedFor('head_mismatch'));
    const closed = openGitHub(pullAt({ state: 'closed' }));
    expect(await mergeOver(app, closed).run(request)).toEqual(refusedFor('pr_not_open'));
    expect([...writesOf(elsewhere), ...writesOf(closed)]).toEqual([]);
  });
});

describe('GH-6 the merge connector reports a merge that already happened without writing', () => {
  it('answers the succeeded outcome of a pull request merged at the head, with only reads', async () => {
    const github = openGitHub(pullAt({ merged: true }));
    github.on('GET', paths.tag, {
      status: 200,
      body: { ref: `refs/tags/${tagName}`, object: { sha: mergeSha, type: 'commit' } },
    });
    expect(await mergeOver(app, github).outcomeOf(request)).toEqual(succeeded('true'));
    expect(writesOf(github)).toEqual([]);
  });

  it('answers a failed tag when the merge has no tag at its sha', async () => {
    const github = openGitHub(pullAt({ merged: true }));
    expect(await mergeOver(app, github).outcomeOf(request)).toEqual(succeeded('true', 'failed'));
    expect(writesOf(github)).toEqual([]);
  });

  it('answers no outcome for an open pull request or one merged at another head', async () => {
    for (const pull of [pullAt(), pullAt({ merged: true, head: otherHead })]) {
      const github = openGitHub(pull);
      expect(await mergeOver(app, github).outcomeOf(request)).toBeNull();
      expect(writesOf(github)).toEqual([]);
    }
  });

  it('answers a refusal, not an absent merge, when GitHub cannot be read', async () => {
    const github = fixtureGitHub();
    github.on('GET', paths.pull, { status: 502, body: { message: 'bad gateway' } });
    expect(await mergeOver(app, github).outcomeOf(request)).toEqual(
      refusedFor('github_server_error'),
    );
  });

  it('carries no installation token in any outcome', async () => {
    const outcomes = [
      await mergeOver(app, openGitHub()).run(request),
      await mergeOver(app, openGitHub(pullAt({ merged: true }))).outcomeOf(request),
      (await refusalOver(403)).outcome,
    ];
    expect(JSON.stringify(outcomes)).not.toContain('ghs_');
  });
});

describe('MD-3 the merge connector merges a joined pull request at its own head ref, pinned to the evaluated head', () => {
  const joined = { ...request, joined: true };
  const contributor = 'feature/login-form';

  it('MD-3 merges a joined pull request whose head ref is the contributor branch, with the sha guard', async () => {
    const github = openGitHub(pullAt({ ref: contributor }));
    expect(await mergeOver(app, github).run(joined)).toEqual(succeeded('false'));
    expect(github.requests().find((entry) => entry.method === 'PUT')?.body).toMatchObject({
      sha: request.expectedHead,
    });
  });

  it('MD-3 still refuses a joined pull request from a fork and one whose head moved, writing nothing', async () => {
    const fork = openGitHub(pullAt({ ref: contributor, headRepo: 'someone/uw-platform' }));
    expect(await mergeOver(app, fork).run(joined)).toEqual(refusedFor('head_repository_mismatch'));
    const moved = openGitHub(pullAt({ ref: contributor, head: otherHead }));
    expect(await mergeOver(app, moved).run(joined)).toEqual(refusedFor('head_mismatch'));
    expect([...writesOf(fork), ...writesOf(moved)]).toEqual([]);
  });

  it('MD-3 an item with a harness branch is still refused head_ref_mismatch at a foreign ref', async () => {
    const github = openGitHub(pullAt({ ref: contributor }));
    expect(await mergeOver(app, github).run(request)).toEqual(refusedFor('head_ref_mismatch'));
  });
});
