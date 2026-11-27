import type { Workspace } from '@uw/harness';
import type { DatabaseHandle } from '../database.ts';
import type { Bindings } from '../env.ts';
import { systemClock } from '../ports/clock.ts';
import { platformWorkspace } from '../ports/workspace.ts';
import { workspaceNotWired } from '../ports/workspace.not-wired.ts';
import { workspaceConfigOf } from './google/config.ts';
import { subjectKindOf } from './google/subjects.ts';
import type { TokenCache } from './google/token.ts';

type WorkspaceHost = {
  readonly env: Bindings;
  readonly database: DatabaseHandle;
  readonly fetch: typeof fetch;
};

export type WorkspaceFactory = (host: WorkspaceHost) => Workspace;

const isolateTokens: TokenCache = new Map();

export const workspaceOf: WorkspaceFactory = ({ env, database, fetch }) => {
  const config = workspaceConfigOf(env);
  if (config === null) return workspaceNotWired;
  const { db } = database;
  const lookup = async (email: string) =>
    email === config.adminSubject ? 'admin' : subjectKindOf(db, email, config.domain);
  return platformWorkspace({
    db,
    domain: config.domain,
    tokens: {
      account: config.account,
      fetcher: fetch,
      now: () => systemClock.now(),
      lookup,
      cache: isolateTokens,
    },
  });
};
