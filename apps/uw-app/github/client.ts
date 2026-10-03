import { z } from 'zod';
import type { DiffRead } from '@uw/harness';
import type { GitHubAppConfig } from './app-config.ts';
import { diffRead } from './diff.ts';
import { failed, type GitHubResult } from './failures.ts';
import { isCount, isFullSha, refusedInput } from './inputs.ts';
import { openSession, shaped, type GitHubSession } from './session.ts';
import type { GitHubTransport } from './transport.ts';

type List = readonly unknown[];
type Page = { readonly items: List; readonly capped: boolean };
type IssueListing = { readonly issues: List; readonly capped: boolean; readonly unparsed: number };

export type GitHubReads = {
  installationRepositories(): Promise<GitHubResult<List>>;
  pullRequest(repo: string, number: number): Promise<GitHubResult<unknown>>;
  changedFiles(
    repo: string,
    base: string,
    head: string,
  ): Promise<GitHubResult<List | 'too_many_files'>>;
  pullRequestReviews(repo: string, number: number): Promise<GitHubResult<List>>;
  checkRuns(repo: string, sha: string): Promise<GitHubResult<List>>;
  issuesSince(
    repo: string,
    since: Date | null,
    maxPages: number,
  ): Promise<GitHubResult<IssueListing>>;
  issueComments(repo: string, number: number, since: Date): Promise<GitHubResult<List>>;
  diff(repo: string, base: string, head: string, budgetBytes: number): Promise<DiffRead>;
};

const readPermissions = {
  contents: 'read',
  pull_requests: 'read',
  issues: 'read',
  checks: 'read',
  metadata: 'read',
} as const;
const perPage = 100;
const listedFiles = 300;
export const LIST_PAGES = 10;
const listPages = LIST_PAGES;
const array = z.array(z.unknown());
const checkRunPage = z.object({ check_runs: array }).transform((page) => page.check_runs);
const repositoryPage = z.object({ repositories: array }).transform((page) => page.repositories);
const record = z.record(z.string(), z.unknown());
const keyed = z.object({
  id: z.number().int().positive(),
  updated_at: z.iso.datetime({ offset: true }),
});
const comparison = z
  .object({ status: z.string().optional(), files: array.optional() })
  .refine((answer) => answer.files !== undefined || answer.status === 'identical')
  .transform((answer) => answer.files ?? []);

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
    changedFiles: (repo: string, base: string, head: string) =>
      refusedUnless(
        isFullSha(base) && isFullSha(head),
        async (): Promise<GitHubResult<List | 'too_many_files'>> => {
          const route = 'GET /repos/{owner}/{repo}/compare/{basehead}';
          const parameters = { basehead: `${base}...${head}`, per_page: 1, page: 1 };
          const answer = await session.request(route, parameters, repo);
          if (!answer.ok) return answer;
          const files = shaped(comparison, answer.value);
          if (!files.ok) return files;
          return {
            ok: true,
            value: files.value.length >= listedFiles ? 'too_many_files' : files.value,
          };
        },
      ),
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

type Keyset = {
  readonly seen: Map<number, { readonly item: unknown; readonly updatedAt: number }>;
  unparsed: number;
  latest: number | null;
  moved: boolean;
  tiedAt: number | null;
};

type Cursor = { readonly from: Date | null; readonly page: number; readonly tie: number | null };

function timeOf(item: unknown): number | null {
  const parsed = keyed.safeParse(item);
  return parsed.success ? Date.parse(parsed.data.updated_at) : null;
}

function admitted(keyset: Keyset, page: List): boolean {
  const before = keyset.seen.size;
  for (const item of page) {
    const parsed = keyed.safeParse(item);
    if (!parsed.success) {
      keyset.unparsed += 1;
      continue;
    }
    const updatedAt = Date.parse(parsed.data.updated_at);
    const held = keyset.seen.get(parsed.data.id);
    if (held !== undefined && held.updatedAt !== updatedAt) keyset.moved = true;
    keyset.seen.set(parsed.data.id, { item, updatedAt });
    keyset.latest = Math.max(keyset.latest ?? updatedAt, updatedAt);
  }
  return keyset.seen.size > before;
}

function listingOf(keyset: Keyset, capped: boolean): GitHubResult<IssueListing> {
  const { tiedAt } = keyset;
  const unsure = tiedAt !== null && (capped || keyset.moved);
  const entries = [...keyset.seen.values()].filter((entry) => !unsure || entry.updatedAt <= tiedAt);
  const issues = entries.sort((a, b) => a.updatedAt - b.updatedAt).map((entry) => entry.item);
  return { ok: true, value: { issues, capped: capped || unsure, unparsed: keyset.unparsed } };
}

function nextCursor(keyset: Keyset, cursor: Cursor, page: List, progressed: boolean) {
  const latest = keyset.latest;
  if (latest === null) return null;
  const { tie } = cursor;
  if (tie !== null) {
    const beyond = page.some((item) => (timeOf(item) ?? tie) > tie);
    return beyond
      ? { from: new Date(latest), page: 1, tie: null }
      : { ...cursor, page: cursor.page + 1 };
  }
  if (progressed) return { from: new Date(latest), page: 1, tie: null };
  if (cursor.from?.getTime() !== latest) return { from: new Date(latest), page: 1, tie: null };
  keyset.tiedAt ??= latest;
  return { from: cursor.from, page: 2, tie: latest };
}

async function keysetIssues(
  session: GitHubSession,
  repo: string,
  since: Date | null,
  maxPages: number,
): Promise<GitHubResult<IssueListing>> {
  const keyset: Keyset = { seen: new Map(), unparsed: 0, latest: null, moved: false, tiedAt: null };
  const filters = { state: 'all', sort: 'updated', direction: 'asc', per_page: perPage };
  let cursor: Cursor | null = { from: since, page: 1, tie: null };
  for (let request = 0; request < maxPages && cursor !== null; request += 1) {
    const { from, page } = cursor;
    const parameters = from
      ? { since: from.toISOString(), ...filters, page }
      : { ...filters, page };
    const answer = await session.request('GET /repos/{owner}/{repo}/issues', parameters, repo);
    if (!answer.ok) return answer;
    const listed = shaped(array, answer.value);
    if (!listed.ok) return listed;
    const progressed = admitted(keyset, listed.value);
    if (listed.value.length < perPage) return listingOf(keyset, false);
    cursor = nextCursor(keyset, cursor, listed.value, progressed);
  }
  return listingOf(keyset, true);
}

function issueReads(session: GitHubSession) {
  return {
    issuesSince: (repo: string, since: Date | null, maxPages: number) =>
      refusedUnless(isCount(maxPages), () => keysetIssues(session, repo, since, maxPages)),
    issueComments: (repo: string, number: number, since: Date) =>
      refusedUnless(isCount(number) && !Number.isNaN(since.getTime()), () =>
        whole(
          session,
          listOf(
            'GET /repos/{owner}/{repo}/issues/{issue_number}/comments',
            { issue_number: number, since: since.toISOString() },
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
    diff: diffRead(session),
  };
}
