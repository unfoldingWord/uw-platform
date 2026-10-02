import { z } from 'zod';
import type { GitHubAppConfig } from './app-config.ts';
import { failed, type GitHubResult } from './failures.ts';
import { isCount, isFullSha, refusedInput } from './inputs.ts';
import { openSession, shaped, type GitHubSession } from './session.ts';
import type { GitHubTransport } from './transport.ts';

type List = readonly unknown[];
type Page = { readonly items: List; readonly capped: boolean };

export type GitHubReads = {
  installationRepositories(): Promise<GitHubResult<List>>;
  pullRequest(repo: string, number: number): Promise<GitHubResult<unknown>>;
  pullRequestFiles(repo: string, number: number): Promise<GitHubResult<List | 'too_many_files'>>;
  pullRequestReviews(repo: string, number: number): Promise<GitHubResult<List>>;
  checkRuns(repo: string, sha: string): Promise<GitHubResult<List>>;
  issuesSince(
    repo: string,
    since: Date | null,
    maxPages: number,
  ): Promise<GitHubResult<{ readonly issues: List; readonly capped: boolean }>>;
  issueComments(repo: string, number: number): Promise<GitHubResult<List>>;
};

const readPermissions = {
  contents: 'read',
  pull_requests: 'read',
  issues: 'read',
  checks: 'read',
  metadata: 'read',
} as const;
const perPage = 100;
const filePages = 30;
const listPages = 10;
const array = z.array(z.unknown());
const checkRunPage = z.object({ check_runs: array }).transform((page) => page.check_runs);
const repositoryPage = z.object({ repositories: array }).transform((page) => page.repositories);
const record = z.record(z.string(), z.unknown());

type Lister = {
  readonly route: string;
  readonly parameters: Record<string, unknown>;
  readonly repository: string | null;
  readonly pageOf: z.ZodType<List>;
  readonly maxPages: number;
};

async function paged(session: GitHubSession, lister: Lister): Promise<GitHubResult<Page>> {
  const items: unknown[] = [];
  for (let page = 1; page <= lister.maxPages; page += 1) {
    const parameters = { ...lister.parameters, per_page: perPage, page };
    const answer = await session.request(lister.route, parameters, lister.repository);
    if (!answer.ok) return answer;
    const list = shaped(lister.pageOf, answer.value);
    if (!list.ok) return list;
    items.push(...list.value);
    if (list.value.length < perPage) return { ok: true, value: { items, capped: false } };
  }
  return { ok: true, value: { items, capped: true } };
}

async function whole(session: GitHubSession, lister: Lister): Promise<GitHubResult<List>> {
  const result = await paged(session, lister);
  if (!result.ok) return result;
  return result.value.capped
    ? failed('unprocessable', null)
    : { ok: true, value: result.value.items };
}

function listOf(route: string, parameters: Record<string, unknown>, repository: string): Lister {
  return { route, parameters, repository, pageOf: array, maxPages: listPages };
}

function refusedUnless<T>(valid: boolean, read: () => Promise<GitHubResult<T>>) {
  return valid ? read() : Promise.resolve(refusedInput);
}

function pullRequestReads(session: GitHubSession) {
  const pulls = '/repos/{owner}/{repo}/pulls/{pull_number}';
  return {
    pullRequest: (repo: string, number: number) =>
      refusedUnless(isCount(number), async () => {
        const answer = await session.request(`GET ${pulls}`, { pull_number: number }, repo);
        return answer.ok ? shaped(record, answer.value) : answer;
      }),
    pullRequestFiles: (repo: string, number: number) =>
      refusedUnless(isCount(number), async (): Promise<GitHubResult<List | 'too_many_files'>> => {
        const lister = listOf(`GET ${pulls}/files`, { pull_number: number }, repo);
        const result = await paged(session, { ...lister, maxPages: filePages });
        if (!result.ok) return result;
        return { ok: true, value: result.value.capped ? 'too_many_files' : result.value.items };
      }),
    pullRequestReviews: (repo: string, number: number) =>
      refusedUnless(isCount(number), () =>
        whole(session, listOf(`GET ${pulls}/reviews`, { pull_number: number }, repo)),
      ),
    checkRuns: (repo: string, sha: string) =>
      refusedUnless(isFullSha(sha), () =>
        whole(session, {
          ...listOf('GET /repos/{owner}/{repo}/commits/{ref}/check-runs', { ref: sha }, repo),
          pageOf: checkRunPage,
        }),
      ),
  };
}

function issueReads(session: GitHubSession) {
  return {
    issuesSince: (repo: string, since: Date | null, maxPages: number) =>
      refusedUnless(isCount(maxPages), async () => {
        const filters = { state: 'all', sort: 'updated', direction: 'asc' };
        const parameters = since ? { since: since.toISOString(), ...filters } : filters;
        const lister = listOf('GET /repos/{owner}/{repo}/issues', parameters, repo);
        const result = await paged(session, { ...lister, maxPages });
        if (!result.ok) return result;
        const { items, capped } = result.value;
        return { ok: true as const, value: { issues: items, capped } };
      }),
    issueComments: (repo: string, number: number) =>
      refusedUnless(isCount(number), () =>
        whole(
          session,
          listOf(
            'GET /repos/{owner}/{repo}/issues/{issue_number}/comments',
            { issue_number: number },
            repo,
          ),
        ),
      ),
  };
}

export function createGitHubReads(
  config: GitHubAppConfig,
  transport: GitHubTransport,
): GitHubReads {
  const session = openSession(config, transport, readPermissions);
  return {
    installationRepositories: () =>
      whole(session, {
        route: 'GET /installation/repositories',
        parameters: {},
        repository: null,
        pageOf: repositoryPage,
        maxPages: listPages,
      }),
    ...pullRequestReads(session),
    ...issueReads(session),
  };
}
