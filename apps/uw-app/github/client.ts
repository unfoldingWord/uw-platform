import { z } from 'zod';
import type { GitHubAppConfig } from './app-config.ts';
import { failed, type GitHubResult } from './failures.ts';
import { refusedInput, openSession, repositoryOf, shaped, type GitHubSession } from './session.ts';
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
  readonly pageOf: z.ZodType<List>;
  readonly maxPages: number;
};

async function paged(session: GitHubSession, lister: Lister): Promise<GitHubResult<Page>> {
  const items: unknown[] = [];
  for (let page = 1; page <= lister.maxPages; page += 1) {
    const answer = await session.request(lister.route, {
      ...lister.parameters,
      per_page: perPage,
      page,
    });
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

function inRepository<T>(
  name: string,
  read: (repository: Record<string, string>) => Promise<GitHubResult<T>>,
): Promise<GitHubResult<T>> {
  const repository = repositoryOf(name);
  return repository ? read({ ...repository }) : Promise.resolve(refusedInput);
}

function listOf(route: string, parameters: Record<string, unknown>): Lister {
  return { route, parameters, pageOf: array, maxPages: listPages };
}

function pullRequestReads(session: GitHubSession) {
  return {
    pullRequest: (repo: string, number: number) =>
      inRepository(repo, async (repository) => {
        const answer = await session.request('GET /repos/{owner}/{repo}/pulls/{pull_number}', {
          ...repository,
          pull_number: number,
        });
        return answer.ok ? shaped(record, answer.value) : answer;
      }),
    pullRequestFiles: (repo: string, number: number) =>
      inRepository(repo, async (repository): Promise<GitHubResult<List | 'too_many_files'>> => {
        const result = await paged(session, {
          ...listOf('GET /repos/{owner}/{repo}/pulls/{pull_number}/files', {
            ...repository,
            pull_number: number,
          }),
          maxPages: filePages,
        });
        if (!result.ok) return result;
        return { ok: true, value: result.value.capped ? 'too_many_files' : result.value.items };
      }),
    pullRequestReviews: (repo: string, number: number) =>
      inRepository(repo, (repository) =>
        whole(
          session,
          listOf('GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews', {
            ...repository,
            pull_number: number,
          }),
        ),
      ),
    checkRuns: (repo: string, sha: string) =>
      inRepository(repo, (repository) =>
        whole(session, {
          ...listOf('GET /repos/{owner}/{repo}/commits/{ref}/check-runs', {
            ...repository,
            ref: sha,
          }),
          pageOf: checkRunPage,
        }),
      ),
  };
}

function issueReads(session: GitHubSession) {
  return {
    issuesSince: (repo: string, since: Date | null, maxPages: number) =>
      inRepository(repo, async (repository) => {
        const result = await paged(session, {
          ...listOf('GET /repos/{owner}/{repo}/issues', {
            ...repository,
            ...(since ? { since: since.toISOString() } : {}),
            state: 'all',
            sort: 'updated',
            direction: 'asc',
          }),
          maxPages,
        });
        if (!result.ok) return result;
        return {
          ok: true as const,
          value: { issues: result.value.items, capped: result.value.capped },
        };
      }),
    issueComments: (repo: string, number: number) =>
      inRepository(repo, (repository) =>
        whole(
          session,
          listOf('GET /repos/{owner}/{repo}/issues/{issue_number}/comments', {
            ...repository,
            issue_number: number,
          }),
        ),
      ),
  };
}

export function createGitHubReads(
  config: GitHubAppConfig,
  transport: GitHubTransport,
): GitHubReads {
  const session = openSession(config, transport);
  return {
    installationRepositories: () =>
      whole(session, { ...listOf('GET /installation/repositories', {}), pageOf: repositoryPage }),
    ...pullRequestReads(session),
    ...issueReads(session),
  };
}
