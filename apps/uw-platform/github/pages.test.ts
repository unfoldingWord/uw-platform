import { beforeAll, describe, expect, it } from 'vitest';
import type { GitHubAppConfig } from './app-config.ts';
import { createGitHubReads } from './client.ts';
import { fixtureApp, fixtureTransport } from './testing/app-key.ts';
import { fixtureGitHub, type FixtureGitHub } from './testing/fixture-github.ts';

const tokenPath = '/app/installations/77/access_tokens';

let app: GitHubAppConfig;

beforeAll(async () => {
  app = await fixtureApp();
});

function pageOf(size: number): { status: number; body: unknown[] } {
  return { status: 200, body: Array.from({ length: size }, (_, index) => ({ index })) };
}

function pages(full: number, last: number | null) {
  const replies = Array.from({ length: full }, () => pageOf(100));
  return last === null ? replies : [...replies, pageOf(last)];
}

function sent(github: FixtureGitHub, path: string) {
  return github.requests().filter((request) => request.path === path && request.path !== tokenPath);
}

function readsOver(github: FixtureGitHub) {
  return createGitHubReads(app, fixtureTransport(github));
}

const head = 'c'.repeat(40);
const base = 'b'.repeat(40);
const comparePath = `/repos/o/r/compare/${base}...${head}`;

function filesOf(size: number): { status: number; body: unknown } {
  const files = Array.from({ length: size }, (_, index) => ({ filename: `f${index}` }));
  return { status: 200, body: { status: 'ahead', commits: [], files } };
}

async function answerTo(body: unknown) {
  const github = fixtureGitHub();
  github.on('GET', comparePath, { status: 200, body });
  return readsOver(github).changedFiles('o/r', base, head);
}

describe('GH-5 the changed files are read by comparing the base SHA with the head SHA', () => {
  it('reads the files of the comparison from that exact base to that exact head', async () => {
    const github = fixtureGitHub();
    github.on('GET', comparePath, filesOf(3));
    const result = await readsOver(github).changedFiles('o/r', base, head);
    expect(result.ok && Array.isArray(result.value.files) && result.value.files.length).toBe(3);
    expect(sent(github, comparePath).map((request) => request.search)).toEqual([
      '?per_page=100&page=1',
    ]);
  });

  it('answers too_many_files when the comparison reaches the 300 files GitHub lists', async () => {
    expect(await answerTo(filesOf(300).body)).toMatchObject({
      ok: true,
      value: { files: 'too_many_files' },
    });
  });

  it('reads 299 files as the whole list', async () => {
    const result = await answerTo(filesOf(299).body);
    expect(result.ok && Array.isArray(result.value.files) && result.value.files.length).toBe(299);
  });

  it('reads an identical comparison with no files listed as no files', async () => {
    expect(await answerTo({ status: 'identical', commits: [] })).toEqual({
      ok: true,
      value: { files: [], behindBy: null, commits: null },
    });
  });

  it('counts any other comparison with no files listed as malformed', async () => {
    expect(await answerTo({ status: 'ahead', commits: [] })).toEqual({
      ok: false,
      failure: 'malformed_response',
      status: 200,
    });
    expect(await answerTo({ commits: [] })).toMatchObject({ ok: false });
  });

  it.each(['main', 'refs/heads/main', 'b'.repeat(39), 'B'.repeat(40), ''])(
    'refuses the base %j, which is not a full SHA, without a request',
    async (named) => {
      const github = fixtureGitHub();
      expect(await readsOver(github).changedFiles('o/r', named, head)).toEqual({
        ok: false,
        failure: 'unprocessable',
        status: null,
      });
      expect(github.requests()).toEqual([]);
    },
  );
});

describe('the other GitHub list reads are whole or refused', () => {
  it('refuses a list longer than ten pages rather than answer part of it', async () => {
    const github = fixtureGitHub();
    github.on('GET', '/repos/o/r/pulls/2/reviews', pages(11, null));
    expect(await readsOver(github).pullRequestReviews('o/r', 2)).toEqual({
      ok: false,
      failure: 'unprocessable',
      status: null,
    });
    expect(sent(github, '/repos/o/r/pulls/2/reviews')).toHaveLength(10);
  });

  it('pages the check runs and the installation repositories out of their wrappers', async () => {
    const github = fixtureGitHub();
    const wrapped = (key: string, size: number) => ({
      status: 200,
      body: { total_count: 150, [key]: pageOf(size).body },
    });
    github.on('GET', `/repos/o/r/commits/${'a'.repeat(40)}/check-runs`, [
      wrapped('check_runs', 100),
      wrapped('check_runs', 50),
    ]);
    github.on('GET', '/installation/repositories', wrapped('repositories', 2));
    const reads = readsOver(github);
    const runs = await reads.checkRuns('o/r', 'a'.repeat(40));
    expect(runs.ok && runs.value.length).toBe(150);
    const repositories = await reads.installationRepositories();
    expect(repositories.ok && repositories.value.length).toBe(2);
  });
});

describe('SR-1 the comparison carries the distance behind the base and the head commits', () => {
  it('SR-1 reads the distance behind the base, and the commits only when GitHub listed all of them', async () => {
    const commits = [{ sha: head }];
    const all = { status: 'ahead', behind_by: 4, total_commits: 1, commits, files: [] };
    expect(await answerTo(all)).toEqual({ ok: true, value: { files: [], behindBy: 4, commits } });
    const some = { ...all, total_commits: 2 };
    expect(await answerTo(some)).toEqual({
      ok: true,
      value: { files: [], behindBy: 4, commits: null },
    });
  });
});
