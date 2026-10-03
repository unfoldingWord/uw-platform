import { beforeAll, describe, expect, it } from 'vitest';
import type { GitHubAppConfig } from './app-config.ts';
import { fixtureApp } from './testing/app-key.ts';
import {
  mergeOver,
  mergeSha,
  openGitHub,
  otherHead,
  paths,
  pullAt,
  request,
  tagName,
  writesOf,
} from './testing/merge-rig.ts';

let app: GitHubAppConfig;

beforeAll(async () => {
  app = await fixtureApp();
});

const squatted = {
  status: 200,
  body: { ref: `refs/tags/${tagName}`, object: { sha: 'f'.repeat(40), type: 'commit' } },
};

describe('GH-6 the merge connector answers a merge GitHub reports oddly without losing it', () => {
  it.each([
    ['merged false', { sha: mergeSha, merged: false }],
    ['an abbreviated sha', { sha: 'ace', merged: true }],
    ['no merged flag', { sha: mergeSha }],
  ])('answers github_malformed_response for a merge answer with %s', async (_name, body) => {
    const github = openGitHub();
    github.on('PUT', paths.merge, { status: 200, body });
    expect(await mergeOver(app, github).run(request)).toEqual({
      outcome: 'refused',
      reason: 'github_malformed_response',
    });
  });

  it('reads a merged pull request again when GitHub has not yet given its merge commit', async () => {
    const github = openGitHub([pullAt({ merged: true, mergeSha: null }), pullAt({ merged: true })]);
    expect(await mergeOver(app, github).run(request)).toEqual({
      outcome: 'succeeded',
      detail: { mergeSha, tag: tagName, already: 'true' },
    });
  });

  it.each([
    ['a fork head', pullAt({ merged: true, headRepo: 'someone/uw-platform' })],
    ['another head', pullAt({ merged: true, head: otherHead })],
    ['an unmerged pull request', pullAt()],
    ['an abbreviated merge commit', pullAt({ merged: true, mergeSha: 'ace' })],
  ])('takes no merge commit from a second read showing %s', async (_name, second) => {
    const github = openGitHub([pullAt({ merged: true, mergeSha: null }), second]);
    expect(await mergeOver(app, github).run(request)).toEqual({
      outcome: 'succeeded',
      detail: { mergeSha: 'unknown', tag: 'none', already: 'true' },
    });
    expect(writesOf(github)).toEqual([]);
  });

  it('answers a merge with no known commit as succeeded without a tag, on run and on recovery', async () => {
    const pull = pullAt({ merged: true, mergeSha: null });
    const expected = {
      outcome: 'succeeded',
      detail: { mergeSha: 'unknown', tag: 'none', already: 'true' },
    };
    expect(await mergeOver(app, openGitHub(pull)).run(request)).toEqual(expected);
    expect(await mergeOver(app, openGitHub(pull)).outcomeOf(request)).toEqual(expected);
  });
});

describe('GH-6 the merge tag reports a tag of the name at another commit as a conflict', () => {
  it('answers tag conflict after a merge when the tag name points elsewhere', async () => {
    const github = openGitHub();
    github.on('POST', paths.refs, { status: 422, body: { message: 'Reference already exists' } });
    github.on('GET', paths.tag, squatted);
    expect(await mergeOver(app, github).run(request)).toMatchObject({
      detail: { tag: 'conflict', already: 'false' },
    });
  });

  it('answers tag failed when GitHub fails the tag, and conflict on recovery for a squatted tag', async () => {
    const failing = openGitHub();
    failing.on('POST', paths.refs, { status: 500, body: { message: 'boom' } });
    expect(await mergeOver(app, failing).run(request)).toMatchObject({ detail: { tag: 'failed' } });
    const merged = openGitHub(pullAt({ merged: true }));
    merged.on('GET', paths.tag, squatted);
    expect(await mergeOver(app, merged).outcomeOf(request)).toMatchObject({
      detail: { tag: 'conflict' },
    });
  });
});
