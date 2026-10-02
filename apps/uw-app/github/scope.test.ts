import { beforeAll, describe, expect, it } from 'vitest';
import type { GitHubAppConfig } from './app-config.ts';
import { createGitHubReads } from './client.ts';
import { createIssueComments } from './comments.ts';
import { createShipWrites } from './ship-writes.ts';
import { fixtureApp, fixtureTransport } from './testing/app-key.ts';
import { fixtureGitHub, type FixtureGitHub } from './testing/fixture-github.ts';

const sha = 'a'.repeat(40);
const tokenPath = '/app/installations/77/access_tokens';
const readSet = {
  contents: 'read',
  pull_requests: 'read',
  issues: 'read',
  checks: 'read',
  metadata: 'read',
};

let app: GitHubAppConfig;

beforeAll(async () => {
  app = await fixtureApp();
});

function mints(github: FixtureGitHub): unknown[] {
  return github
    .requests()
    .filter((request) => request.path === tokenPath)
    .map((request) => request.body);
}

async function everyRead(github: FixtureGitHub): Promise<void> {
  const reads = createGitHubReads(app, fixtureTransport(github));
  await reads.pullRequest('o/r', 2);
  await reads.changedFiles('o/r', 'main', sha);
  await reads.pullRequestReviews('o/r', 2);
  await reads.checkRuns('o/r', sha);
  await reads.issuesSince('o/r', null, 1);
  await reads.issueComments('o/r', 1);
  await reads.installationRepositories();
}

describe('GH-1 each read token is scoped to one repository and read permissions', () => {
  it('mints the read client token for the repository with read permissions only', async () => {
    const github = fixtureGitHub();
    await createGitHubReads(app, fixtureTransport(github)).pullRequest('o/r', 2);
    expect(mints(github)).toEqual([{ repositories: ['r'], permissions: readSet }]);
  });

  it('never asks for a write permission from any read', async () => {
    const github = fixtureGitHub();
    await everyRead(github);
    const asked = mints(github).flatMap((body) =>
      Object.values((body as { permissions: Record<string, string> }).permissions),
    );
    expect(asked.length).toBeGreaterThan(0);
    expect(asked.every((level) => level === 'read')).toBe(true);
  });

  it('lists the installation repositories with a metadata read token for no repository', async () => {
    const github = fixtureGitHub();
    await createGitHubReads(app, fixtureTransport(github)).installationRepositories();
    expect(mints(github)).toEqual([{ permissions: { metadata: 'read' } }]);
  });
});

describe('GH-1 each writer token is scoped to one repository and the write it makes', () => {
  it('mints the comment token with issues write for the repository', async () => {
    const github = fixtureGitHub();
    await createIssueComments(app, fixtureTransport(github)).comment('o/r', 1, 'see');
    expect(mints(github)).toEqual([
      { repositories: ['r'], permissions: { issues: 'write', metadata: 'read' } },
    ]);
  });

  it('mints the merge and tag token with contents write for the repository', async () => {
    const github = fixtureGitHub();
    const writes = createShipWrites(app, fixtureTransport(github));
    await writes.merge('o/r', 2, { sha, title: 't', message: 'm' });
    await writes.tag('o/r', 'harness/x', sha);
    expect(mints(github)).toEqual([
      {
        repositories: ['r'],
        permissions: { contents: 'write', pull_requests: 'read', metadata: 'read' },
      },
    ]);
  });
});

describe('a unit of work concerns one repository', () => {
  it('refuses a second repository in one unit of work without a request', async () => {
    const github = fixtureGitHub();
    const reads = createGitHubReads(app, fixtureTransport(github));
    await reads.pullRequest('o/r', 2);
    const before = github.requests().length;
    expect(await reads.pullRequest('o/other', 2)).toEqual({
      ok: false,
      failure: 'unprocessable',
      status: null,
    });
    expect(await reads.pullRequest('O/R', 3)).not.toEqual({
      ok: false,
      failure: 'unprocessable',
      status: null,
    });
    expect(github.requests().length).toBe(before + 1);
  });
});
