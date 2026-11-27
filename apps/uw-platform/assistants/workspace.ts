import type { Workspace } from '@uw/harness';
import type { Executor } from '@uw/db/client';
import type { DatabaseHandle } from '../database.ts';
import type { Bindings } from '../env.ts';
import { systemClock } from '../ports/clock.ts';
import { platformWorkspace } from '../ports/workspace.ts';
import { workspaceNotWired } from '../ports/workspace.not-wired.ts';
import { workspaceConfigOf, type WorkspaceConfig } from './google/config.ts';
import { subjectKindOf } from './google/subjects.ts';
import type { TokenCache, TokenDeps } from './google/token.ts';

type WorkspaceHost = {
  readonly env: Bindings;
  readonly database: DatabaseHandle;
  readonly fetch: typeof fetch;
};

export type WorkspaceFactory = (host: WorkspaceHost) => Workspace;
export type GoogleAccess = { readonly config: WorkspaceConfig; readonly tokens: TokenDeps };

export const isolateTokens: TokenCache = new Map();

export function googleAccessOf(
  env: Bindings,
  db: Executor,
  fetcher: typeof fetch,
  now: () => Date = () => systemClock.now(),
): GoogleAccess | null {
  const config = workspaceConfigOf(env);
  if (config === null) return null;
  const lookup = async (email: string) =>
    email === config.adminSubject ? 'admin' : subjectKindOf(db, email, config.domain);
  return {
    config,
    tokens: { account: config.account, fetcher, now, lookup, cache: isolateTokens },
  };
}

export const workspaceOf: WorkspaceFactory = ({ env, database, fetch }) => {
  const access = googleAccessOf(env, database.db, fetch);
  if (access === null) return workspaceNotWired;
  return platformWorkspace({
    db: database.db,
    domain: access.config.domain,
    tokens: access.tokens,
  });
};
