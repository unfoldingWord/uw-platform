import type { ErrorReason, Page } from '@uw/contracts';
import type { Logger } from '@uw/core/log';
import type { Caller, Clock, Kernel } from '@uw/harness';
import type { DatabaseHandle } from '../database.ts';
import { issueByNumber } from '../github/facts/queries.ts';
import { importStoredIssue, isImportable } from '../github/import.ts';
import { readPage } from '../pages/store.ts';
import type { LiveWiring } from '../kernel.ts';
import type { ShipGitHub } from '../ports/connectors.ts';
import { gateKernel } from './person/gate-kernel.ts';

type StoredIssue = NonNullable<Awaited<ReturnType<typeof issueByNumber>>>;
type Imported = { readonly ok: true } | { readonly ok: false; readonly reason: ErrorReason };

export type GateAccess = 'none' | 'ordinary' | 'github';

export type CommandCapabilities = {
  readonly pages: { readonly read: (pageId: string) => Promise<Page | null> };
  readonly githubIssues: {
    readonly byNumber: (repository: string, number: number) => Promise<StoredIssue | null>;
  };
  readonly importIssue: (issue: StoredIssue) => Promise<Imported>;
  readonly gateKernel: () => Kernel;
};

export type CapabilityGrounds = {
  readonly command: string;
  readonly database: DatabaseHandle;
  readonly kernel: Kernel;
  readonly caller: Caller;
  readonly clock: Clock;
  readonly live: LiveWiring;
  readonly logger: Logger;
  readonly gate: GateAccess;
  readonly gateGitHub: () => ShipGitHub | null;
};

function gateKernelOf(grounds: CapabilityGrounds): () => Kernel {
  const { command, database, clock, live, logger } = grounds;
  if (grounds.gate === 'ordinary') return () => grounds.kernel;
  if (grounds.gate === 'github') {
    return () => gateKernel(database, clock, grounds.gateGitHub(), live, logger);
  }
  return () => {
    throw new TypeError(`the ${command} command builds no gate kernel`);
  };
}

function importerOf(grounds: CapabilityGrounds): CommandCapabilities['importIssue'] {
  const { db } = grounds.database;
  const deps = { db, kernel: grounds.kernel, client: null, now: () => grounds.clock.now() };
  return async (issue) => {
    if (!isImportable(issue)) return { ok: false, reason: 'not_permitted' };
    const imported = await importStoredIssue(deps, grounds.caller, issue, grounds.logger, 'sweep');
    return imported.ok ? { ok: true } : imported;
  };
}

export function commandCapabilities(grounds: CapabilityGrounds): CommandCapabilities {
  const { db } = grounds.database;
  const { actor } = grounds.caller;
  return {
    pages: { read: (pageId) => readPage(db, actor, pageId, grounds.clock.now()) },
    githubIssues: { byNumber: (repository, number) => issueByNumber(db, repository, number) },
    importIssue: importerOf(grounds),
    gateKernel: gateKernelOf(grounds),
  };
}
