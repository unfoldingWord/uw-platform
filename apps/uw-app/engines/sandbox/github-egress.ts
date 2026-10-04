import { z } from 'zod';
import { parseDeclaration } from '@uw/harness';
import { parseRefUpdates } from './pkt-line.ts';

export const GITHUB_HOST = 'github.internal';
export const GITHUB_API_HOST = 'api.github.internal';

export type GitHubEgress = {
  readonly repository: string;
  readonly branch: string;
  readonly defaultBranch: string;
  readonly token: () => Promise<string | null>;
  readonly unwired: (host: string, path: string) => void;
};

export type GitHubRoute = {
  readonly github: GitHubEgress | null;
  readonly admit: () => Promise<boolean>;
  readonly refused: (host: string, path: string) => void;
};

type Upstream = 'git' | 'api';
type Allowed = {
  readonly upstream: Upstream;
  readonly url: URL;
  readonly method: 'GET' | 'POST';
  readonly body: ArrayBuffer | null;
  readonly headers: readonly string[];
};

const ZERO = '0'.repeat(40);
const API_VERSION = '2022-11-28';
const baseHeaders = ['content-type', 'accept', 'user-agent'];
const uploadHeaders = [...baseHeaders, 'content-encoding', 'git-protocol'];
const upstreams: ReadonlyMap<Upstream, string> = new Map([
  ['git', 'https://github.com'],
  ['api', 'https://api.github.com'],
]);
const pullRequestSchema = z.strictObject({
  title: z.string().min(1).max(256),
  head: z.string().min(1),
  base: z.string().min(1),
  body: z.string().min(1).max(65_536),
  draft: z.boolean().optional(),
});
const listQuery = new Set(['head', 'state']);
const states = new Set(['open', 'closed', 'all']);

function same(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function ownerOf(route: GitHubEgress): string {
  return route.repository.split('/')[0] ?? '';
}

function namesBranch(route: GitHubEgress, head: string): boolean {
  if (head === route.branch) return true;
  const [owner, ...rest] = head.split(':');
  return rest.join(':') === route.branch && same(owner ?? '', ownerOf(route));
}

function onlyQuery(url: URL, key: string, value: string): boolean {
  const keys = [...url.searchParams.keys()];
  return keys.length === 1 && keys[0] === key && url.searchParams.get(key) === value;
}

function gitPath(url: URL, route: GitHubEgress): string | null {
  const prefix = `/${route.repository.toLowerCase()}.git/`;
  const path = url.pathname;
  return path.toLowerCase().startsWith(prefix) ? path.slice(prefix.length) : null;
}

function plainBody(request: Request): boolean {
  const encoding = request.headers.get('content-encoding');
  return encoding === null || encoding.trim().toLowerCase() === 'identity';
}

function pushesOnlyBranch(body: ArrayBuffer, route: GitHubEgress): boolean {
  const updates = parseRefUpdates(new Uint8Array(body));
  if (updates?.length !== 1) return false;
  const [update] = updates;
  return update?.ref === `refs/heads/${route.branch}` && update.new !== ZERO;
}

async function pushAllowed(
  request: Request,
  url: URL,
  route: GitHubEgress,
): Promise<Allowed | null> {
  if (!plainBody(request)) return null;
  const body = await request.arrayBuffer();
  return pushesOnlyBranch(body, route)
    ? { upstream: 'git', url, method: 'POST', body, headers: baseHeaders }
    : null;
}

async function gitAllowed(
  request: Request,
  url: URL,
  route: GitHubEgress,
): Promise<Allowed | null> {
  const rest = gitPath(url, route);
  const git = { upstream: 'git' as const, url };
  if (request.method === 'GET' && rest === 'info/refs') {
    if (onlyQuery(url, 'service', 'git-upload-pack')) {
      return { ...git, method: 'GET', body: null, headers: uploadHeaders };
    }
    const pushing = onlyQuery(url, 'service', 'git-receive-pack');
    return pushing ? { ...git, method: 'GET', body: null, headers: baseHeaders } : null;
  }
  if (request.method !== 'POST' || url.search !== '') return null;
  if (rest === 'git-upload-pack') {
    const body = await request.arrayBuffer();
    return { ...git, method: 'POST', body, headers: uploadHeaders };
  }
  return rest === 'git-receive-pack' ? pushAllowed(request, url, route) : null;
}

function listsBranch(url: URL, route: GitHubEgress): boolean {
  const keys = [...url.searchParams.keys()];
  if (keys.some((key) => !listQuery.has(key)) || new Set(keys).size !== keys.length) return false;
  const state = url.searchParams.get('state');
  if (state !== null && !states.has(state)) return false;
  return namesBranch(route, url.searchParams.get('head') ?? '');
}

async function opensPullRequest(body: ArrayBuffer, route: GitHubEgress): Promise<boolean> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(body));
  } catch {
    return false;
  }
  const opened = pullRequestSchema.safeParse(parsed);
  if (!opened.success) return false;
  const { head, base, body: text } = opened.data;
  return namesBranch(route, head) && base === route.defaultBranch && parseDeclaration(text).ok;
}

async function apiAllowed(
  request: Request,
  url: URL,
  route: GitHubEgress,
): Promise<Allowed | null> {
  if (!same(url.pathname, `/repos/${route.repository}/pulls`)) return null;
  const api = { upstream: 'api' as const, url, headers: baseHeaders };
  if (request.method === 'GET') {
    return listsBranch(url, route) ? { ...api, method: 'GET', body: null } : null;
  }
  if (request.method !== 'POST' || url.search !== '' || !plainBody(request)) return null;
  const body = await request.arrayBuffer();
  return (await opensPullRequest(body, route)) ? { ...api, method: 'POST', body } : null;
}

function upstreamRequest(request: Request, allowed: Allowed, token: string): Request {
  const headers = new Headers();
  for (const name of allowed.headers) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  if (allowed.upstream === 'git') {
    headers.set('authorization', `Basic ${btoa(`x-access-token:${token}`)}`);
  } else {
    headers.set('authorization', `Bearer ${token}`);
    headers.set('x-github-api-version', API_VERSION);
  }
  const target = `${upstreams.get(allowed.upstream) ?? ''}${allowed.url.pathname}${allowed.url.search}`;
  return new Request(target, {
    method: allowed.method,
    headers,
    body: allowed.body,
    redirect: 'manual',
  });
}

function refusal(route: GitHubRoute, url: URL): Response {
  route.refused(url.hostname, url.pathname);
  return new Response('egress refused', { status: 403 });
}

async function allowedOf(
  request: Request,
  url: URL,
  github: GitHubEgress,
): Promise<Allowed | null> {
  return url.hostname === GITHUB_HOST
    ? gitAllowed(request, url, github)
    : apiAllowed(request, url, github);
}

export async function githubEgress(
  request: Request,
  route: GitHubRoute,
  fetcher: (request: Request) => Promise<Response>,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.hostname !== GITHUB_HOST && url.hostname !== GITHUB_API_HOST) return null;
  const { github } = route;
  if (github === null || url.protocol !== 'http:' || url.port !== '') return refusal(route, url);
  const allowed = await allowedOf(request, url, github);
  if (allowed === null) return refusal(route, url);
  if (!(await route.admit())) return new Response('run halted', { status: 403 });
  const minted = await github.token();
  if (minted === null) {
    github.unwired(url.hostname, url.pathname);
    return new Response('egress not configured', { status: 503 });
  }
  return fetcher(upstreamRequest(request, allowed, minted));
}
