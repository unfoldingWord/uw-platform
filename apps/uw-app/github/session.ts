import { Octokit } from '@octokit/core';
import { z } from 'zod';
import type { GitHubAppConfig } from './app-config.ts';
import { failed, failureOf, type GitHubResult } from './failures.ts';
import { installationToken } from './token.ts';
import type { GitHubTransport } from './transport.ts';

type Answer = { readonly status: number; readonly data: unknown };
type Parameters = Record<string, unknown>;

export type GitHubSession = {
  request(route: string, parameters: Parameters): Promise<GitHubResult<Answer>>;
};

type Repository = { readonly owner: string; readonly repo: string };

const apiVersion = { 'x-github-api-version': '2022-11-28' };
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
): Promise<GitHubResult<Octokit>> {
  const token = await installationToken(config, transport);
  if (!token.ok) return token;
  const octokit = new Octokit({
    auth: token.value,
    userAgent: 'uw-platform',
    request: { fetch: transport.fetch },
  });
  return { ok: true, value: octokit };
}

export function openSession(config: GitHubAppConfig, transport: GitHubTransport): GitHubSession {
  let client: Promise<GitHubResult<Octokit>> | null = null;
  return {
    async request(route, parameters) {
      client ??= connect(config, transport);
      const octokit = await client;
      if (!octokit.ok) return octokit;
      try {
        const response = await octokit.value.request(route, { ...parameters, headers: apiVersion });
        return answered(response.status, response.data);
      } catch (error) {
        return refused(error);
      }
    },
  };
}

const ownerName = /^[A-Za-z0-9-]+$/;
const repositoryName = /^[A-Za-z0-9._-]+$/;

export function repositoryOf(name: string): Repository | null {
  const parts = name.split('/');
  const [owner, repo] = parts;
  if (parts.length !== 2 || !owner || !repo) return null;
  if (!ownerName.test(owner) || !repositoryName.test(repo) || /^\.+$/.test(repo)) return null;
  return { owner, repo };
}

export function shaped<T>(schema: z.ZodType<T>, answer: Answer): GitHubResult<T> {
  const parsed = schema.safeParse(answer.data);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : failed('malformed_response', answer.status);
}

export const refusedInput = failed('unprocessable', null);
