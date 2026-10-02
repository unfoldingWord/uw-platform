import { Octokit } from '@octokit/core';
import { z } from 'zod';
import type { GitHubAppConfig } from './app-config.ts';
import { failed, failureOf, type GitHubResult } from './failures.ts';
import { refusedInput } from './inputs.ts';
import { installationToken, type TokenScope } from './token.ts';
import type { GitHubTransport } from './transport.ts';

type Answer = { readonly status: number; readonly data: unknown };
type Parameters = Record<string, unknown>;
type Permissions = TokenScope['permissions'];
type Minted = { readonly octokit: Octokit; readonly expiresAt: Date };
type Minter = () => Promise<GitHubResult<Minted>>;

export type GitHubSession = {
  request(
    route: string,
    parameters: Parameters,
    repository: string | null,
  ): Promise<GitHubResult<Answer>>;
};

const apiVersion = { 'x-github-api-version': '2022-11-28' };
const refreshMargin = 5 * 60_000;
const installationPermissions: Permissions = { metadata: 'read' };
const ownerName = /^[A-Za-z0-9-]+$/;
const repositoryName = /^[A-Za-z0-9._-]+$/;
const refusal = z.object({
  status: z.number().int(),
  response: z.object({ headers: z.record(z.string(), z.unknown()) }),
});

function headersOf(record: Record<string, unknown>): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(record)) {
    if (typeof value === 'string') headers.set(name, value);
  }
  return headers;
}

function refused(error: unknown): GitHubResult<never> {
  const parsed = refusal.safeParse(error);
  if (!parsed.success) return failed('unreachable', null);
  const { status, response } = parsed.data;
  return failed(failureOf(status, headersOf(response.headers)), status);
}

function answered(status: number, data: unknown): GitHubResult<Answer> {
  if (typeof data !== 'object' || data === null || data instanceof ArrayBuffer) {
    return failed('malformed_response', status);
  }
  return { ok: true, value: { status, data } };
}

async function connect(
  config: GitHubAppConfig,
  transport: GitHubTransport,
  scope: TokenScope,
): Promise<GitHubResult<Minted>> {
  const issued = await installationToken(config, transport, scope);
  if (!issued.ok) return issued;
  const octokit = new Octokit({
    auth: issued.value.token,
    userAgent: 'uw-platform',
    request: { fetch: transport.fetch },
  });
  return { ok: true, value: { octokit, expiresAt: issued.value.expiresAt } };
}

function minter(config: GitHubAppConfig, transport: GitHubTransport, scope: TokenScope): Minter {
  let pending: Promise<GitHubResult<Minted>> | null = null;
  const start = (): Promise<GitHubResult<Minted>> => {
    const attempt: Promise<GitHubResult<Minted>> = connect(config, transport, scope)
      .catch(() => failed('unreachable', null))
      .then((result) => {
        if (!result.ok && pending === attempt) pending = null;
        return result;
      });
    pending = attempt;
    return attempt;
  };
  return async () => {
    const held = await (pending ?? start());
    if (!held.ok) return held;
    const left = held.value.expiresAt.getTime() - transport.now().getTime();
    return left > refreshMargin ? held : start();
  };
}

function split(name: string): { readonly owner: string; readonly repo: string } | null {
  const parts = name.split('/');
  const [owner, repo] = parts;
  if (parts.length !== 2 || !owner || !repo) return null;
  if (!ownerName.test(owner) || !repositoryName.test(repo) || /^\.+$/.test(repo)) return null;
  return { owner, repo };
}

async function send(
  mint: Minter,
  route: string,
  parameters: Parameters,
): Promise<GitHubResult<Answer>> {
  try {
    const minted = await mint();
    if (!minted.ok) return minted;
    const response = await minted.value.octokit.request(route, {
      ...parameters,
      headers: apiVersion,
    });
    return answered(response.status, response.data);
  } catch (error) {
    return refused(error);
  }
}

export function openSession(
  config: GitHubAppConfig,
  transport: GitHubTransport,
  permissions: Permissions,
): GitHubSession {
  const installation = minter(config, transport, {
    repository: null,
    permissions: installationPermissions,
  });
  let scoped: { readonly name: string; readonly mint: Minter } | null = null;
  return {
    async request(route, parameters, repository) {
      if (repository === null) return send(installation, route, parameters);
      const parts = split(repository);
      if (!parts) return refusedInput;
      const name = repository.toLowerCase();
      scoped ??= { name, mint: minter(config, transport, { repository: parts.repo, permissions }) };
      if (scoped.name !== name) return refusedInput;
      return send(scoped.mint, route, { ...parameters, ...parts });
    },
  };
}

export function shaped<T>(schema: z.ZodType<T>, answer: Answer): GitHubResult<T> {
  const parsed = schema.safeParse(answer.data);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : failed('malformed_response', answer.status);
}
