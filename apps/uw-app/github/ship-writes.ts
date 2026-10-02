import { z } from 'zod';
import type { GitHubAppConfig } from './app-config.ts';
import { failed, type GitHubResult } from './failures.ts';
import { isCount, isFullSha, refusedInput } from './inputs.ts';
import { openSession, shaped, type GitHubSession } from './session.ts';
import type { GitHubTransport } from './transport.ts';

type Merge = { readonly sha: string; readonly title: string; readonly message: string };
type Tagged = GitHubResult<{ readonly created: boolean }>;

const shipPermissions = { contents: 'write', pull_requests: 'read', metadata: 'read' } as const;
const tagName = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const merged = z.object({ sha: z.string().min(1) }).transform(({ sha }) => ({ sha }));
const lightweightRef = z.object({ object: z.object({ sha: z.string(), type: z.string() }) });

function isTagName(name: string): boolean {
  return (
    tagName.test(name) && name.split('/').every((part) => part !== '' && !part.startsWith('.'))
  );
}

async function existingTag(
  session: GitHubSession,
  repo: string,
  name: string,
  sha: string,
): Promise<Tagged> {
  const answer = await session.request(
    'GET /repos/{owner}/{repo}/git/ref/tags/{+name}',
    { name },
    repo,
  );
  if (!answer.ok) return answer;
  const ref = shaped(lightweightRef, answer.value);
  if (!ref.ok) return ref;
  const { object } = ref.value;
  return object.type === 'commit' && object.sha === sha
    ? { ok: true, value: { created: false } }
    : failed('conflict', 422);
}

function merge(session: GitHubSession) {
  return async (
    repo: string,
    number: number,
    change: Merge,
  ): Promise<GitHubResult<{ readonly sha: string }>> => {
    if (!isCount(number) || !isFullSha(change.sha)) return refusedInput;
    const answer = await session.request(
      'PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge',
      {
        pull_number: number,
        merge_method: 'squash',
        sha: change.sha,
        commit_title: change.title,
        commit_message: change.message,
      },
      repo,
    );
    return answer.ok ? shaped(merged, answer.value) : answer;
  };
}

function tag(session: GitHubSession) {
  return async (repo: string, name: string, sha: string): Promise<Tagged> => {
    if (!isTagName(name) || !isFullSha(sha)) return refusedInput;
    const answer = await session.request(
      'POST /repos/{owner}/{repo}/git/refs',
      { ref: `refs/tags/${name}`, sha },
      repo,
    );
    if (answer.ok) return { ok: true, value: { created: true } };
    if (answer.status !== 422) return answer;
    return existingTag(session, repo, name, sha);
  };
}

export function createShipWrites(config: GitHubAppConfig, transport: GitHubTransport) {
  const session = openSession(config, transport, shipPermissions);
  return { merge: merge(session), tag: tag(session) };
}
