import { beforeAll, describe, expect, it } from 'vitest';
import type { GitHubAppConfig } from './app-config.ts';
import { createGitHubReads } from './client.ts';
import { createIssueComments } from './comments.ts';
import type { GitHubResult } from './failures.ts';
import { createShipWrites } from './ship-writes.ts';
import { fixtureApp, fixtureTransport } from './testing/app-key.ts';
import { fixtureGitHub, type FixtureGitHub } from './testing/fixture-github.ts';

const sha = 'a'.repeat(40);
const tokenPath = '/app/installations/77/access_tokens';

let app: GitHubAppConfig;

beforeAll(async () => {
  app = await fixtureApp();
});

function programmed(): FixtureGitHub {
  const github = fixtureGitHub();
  const ok = (body: unknown) => ({ status: 200, body });
  github.on('GET', '/installation/repositories', ok({ total_count: 1, repositories: [{}] }));
  github.on('GET', '/repos/o/r/pulls/2', ok({ number: 2 }));
  github.on('GET', `/repos/o/r/compare/main...${sha}`, ok({ files: [{ filename: 'a.ts' }] }));
  github.on('GET', '/repos/o/r/pulls/2/reviews', ok([{ id: 1 }]));
  github.on(
    'GET',
    `/repos/o/r/commits/${sha}/check-runs`,
    ok({ total_count: 1, check_runs: [{}] }),
  );
  github.on('GET', '/repos/o/r/issues', ok([{ number: 1 }]));
  github.on('GET', '/repos/o/r/issues/1/comments', ok([{ id: 5 }]));
  github.on('POST', '/repos/o/r/issues/1/comments', { status: 201, body: { id: 9100000001 } });
  github.on('PUT', '/repos/o/r/pulls/2/merge', ok({ sha: 'b'.repeat(40), merged: true }));
  github.on('POST', '/repos/o/r/git/refs', { status: 201, body: { ref: 'refs/tags/harness/x' } });
  return github;
}

async function everyCall(github: FixtureGitHub): Promise<GitHubResult<unknown>[]> {
  const transport = fixtureTransport(github);
  const reads = createGitHubReads(app, transport);
  const writes = createShipWrites(app, transport);
  const comments = createIssueComments(app, transport);
  return [
    await reads.installationRepositories(),
    await reads.pullRequest('o/r', 2),
    await reads.changedFiles('o/r', 'main', sha),
    await reads.pullRequestReviews('o/r', 2),
    await reads.checkRuns('o/r', sha),
    await reads.issuesSince('o/r', null, 3),
    await reads.issueComments('o/r', 1),
    await comments.comment('o/r', 1, 'see the item'),
    await writes.merge('o/r', 2, { sha, title: 'Ship x', message: 'Item x' }),
    await writes.tag('o/r', 'harness/x', sha),
  ];
}

describe('GH-1 write-back is a comment, the merge and the merge tag, and no token leaves the client', () => {
  it('offers only those three writes', () => {
    const transport = fixtureTransport(fixtureGitHub());
    expect(Object.keys(createShipWrites(app, transport)).sort()).toEqual(['merge', 'tag']);
    expect(Object.keys(createIssueComments(app, transport))).toEqual(['comment']);
  });

  it('sends GETs and exactly the comment, the squash merge and the tag ref', async () => {
    const github = programmed();
    await everyCall(github);
    const sent = github.requests().filter((request) => request.path !== tokenPath);
    expect(sent.filter((request) => request.method !== 'GET')).toEqual([
      expect.objectContaining({
        method: 'POST',
        path: '/repos/o/r/issues/1/comments',
        body: { body: 'see the item' },
      }),
      expect.objectContaining({
        method: 'PUT',
        path: '/repos/o/r/pulls/2/merge',
        body: { merge_method: 'squash', sha, commit_title: 'Ship x', commit_message: 'Item x' },
      }),
      expect.objectContaining({
        method: 'POST',
        path: '/repos/o/r/git/refs',
        body: { ref: 'refs/tags/harness/x', sha },
      }),
    ]);
  });

  it('answers every call without a token or a JWT in the value', async () => {
    const results = await everyCall(programmed());
    expect(results.every((result) => result.ok)).toBe(true);
    for (const result of results) {
      const text = JSON.stringify(result);
      expect(text).not.toContain('ghs_');
      expect(text).not.toContain('eyJ');
    }
  });

  it('answers the written values', async () => {
    const results = await everyCall(programmed());
    expect(results.slice(-3)).toEqual([
      { ok: true, value: { id: 9100000001 } },
      { ok: true, value: { sha: 'b'.repeat(40) } },
      { ok: true, value: { created: true } },
    ]);
  });
});
