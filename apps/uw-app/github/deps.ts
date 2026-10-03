import type { Database } from '@uw/db/client';
import type { Kernel } from '@uw/harness';
import type { GitHubAppConfig } from './app-config.ts';
import { createGitHubReads, type GitHubReads } from './client.ts';
import { createIssueComments, type IssueComments } from './comments.ts';
import type { GitHubTransport } from './transport.ts';

export type GitHubClient = {
  readonly reads: () => GitHubReads;
  readonly comments: () => IssueComments;
};

export type GitHubDeps = {
  readonly db: Database;
  readonly kernel: Kernel;
  readonly client: GitHubClient | null;
  readonly now: () => Date;
};

function once<T>(open: () => T): () => T {
  let held: { readonly value: T } | null = null;
  return () => {
    held ??= { value: open() };
    return held.value;
  };
}

export function githubClient(app: GitHubAppConfig, transport: GitHubTransport): GitHubClient {
  return {
    reads: () => createGitHubReads(app, transport),
    comments: () => createIssueComments(app, transport),
  };
}

export function unitOfWork(deps: GitHubDeps): GitHubDeps {
  const { client } = deps;
  if (client === null) return deps;
  return { ...deps, client: { reads: once(client.reads), comments: once(client.comments) } };
}
