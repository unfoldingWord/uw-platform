import { z } from 'zod';
import type { GitHubAppConfig } from './app-config.ts';
import { failed, type GitHubResult } from './failures.ts';
import { refusedInput, openSession, repositoryOf, shaped, type GitHubSession } from './session.ts';
import type { GitHubTransport } from './transport.ts';

type Merge = { readonly sha: string; readonly title: string; readonly message: string };

const tagName = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

function tagNameOf(name: string): boolean {
  return (
    tagName.test(name) && name.split('/').every((part) => part !== '' && !part.startsWith('.'))
  );
}
const merged = z.object({ sha: z.string().min(1) }).transform(({ sha }) => ({ sha }));
const existingRef = z.object({ object: z.object({ sha: z.string() }) });

async function existingTag(
  session: GitHubSession,
  repository: Record<string, string>,
  name: string,
  sha: string,
): Promise<GitHubResult<{ readonly created: boolean }>> {
  const answer = await session.request('GET /repos/{owner}/{repo}/git/ref/tags/{+name}', {
    ...repository,
    name,
  });
  if (!answer.ok) return answer;
  const ref = shaped(existingRef, answer.value);
  if (!ref.ok) return ref;
  return ref.value.object.sha === sha
    ? { ok: true, value: { created: false } }
    : failed('conflict', 422);
}

function merge(session: GitHubSession) {
  return async (
    repo: string,
    number: number,
    change: Merge,
  ): Promise<GitHubResult<{ readonly sha: string }>> => {
    const repository = repositoryOf(repo);
    if (!repository) return refusedInput;
    const answer = await session.request('PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge', {
      ...repository,
      pull_number: number,
      merge_method: 'squash',
      sha: change.sha,
      commit_title: change.title,
      commit_message: change.message,
    });
    return answer.ok ? shaped(merged, answer.value) : answer;
  };
}

function tag(session: GitHubSession) {
  return async (
    repo: string,
    name: string,
    sha: string,
  ): Promise<GitHubResult<{ readonly created: boolean }>> => {
    const repository = repositoryOf(repo);
    if (!repository || !tagNameOf(name)) return refusedInput;
    const answer = await session.request('POST /repos/{owner}/{repo}/git/refs', {
      ...repository,
      ref: `refs/tags/${name}`,
      sha,
    });
    if (answer.ok) return { ok: true, value: { created: true } };
    if (answer.status !== 422) return answer;
    return existingTag(session, { ...repository }, name, sha);
  };
}

export function createShipWrites(config: GitHubAppConfig, transport: GitHubTransport) {
  const session = openSession(config, transport);
  return { merge: merge(session), tag: tag(session) };
}
