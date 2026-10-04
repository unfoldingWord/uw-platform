import {
  createPageCommandSchema,
  type ErrorReason,
  type Harness,
  type Page,
  type TemplateKey,
} from '@uw/contracts';
import type { Logger } from '@uw/core/log';
import { personaPageDraft, personasOf, type Caller, type Clock, type Kernel } from '@uw/harness';
import type { DatabaseHandle } from '../database.ts';
import { issueByNumber } from '../github/facts/queries.ts';
import { importStoredIssue, isImportable } from '../github/import.ts';
import { createPage, readPage } from '../pages/store.ts';
import type { LiveWiring } from '../kernel.ts';
import type { ShipGitHub } from '../ports/connectors.ts';
import { gateKernel } from './person/gate-kernel.ts';

type StoredIssue = NonNullable<Awaited<ReturnType<typeof issueByNumber>>>;
type Imported = { readonly ok: true } | { readonly ok: false; readonly reason: ErrorReason };

export type GateAccess = 'none' | 'ordinary' | 'github';

type Drafted = { readonly drafted: number; readonly skipped: number };
type DraftPersonas = (template: TemplateKey, harness: Harness) => Promise<Drafted>;

export type CommandCapabilities = {
  readonly pages: {
    readonly read: (pageId: string) => Promise<Page | null>;
    readonly draftPersonas: DraftPersonas;
  };
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

function drafterOf(grounds: CapabilityGrounds): DraftPersonas {
  const { db } = grounds.database;
  const { actor, traceId } = grounds.caller;
  return async (template, harness) => {
    let drafted = 0;
    const fixtures = personasOf(template);
    for (const fixture of fixtures) {
      const draft = personaPageDraft(fixture, harness, actor.identity);
      const command = createPageCommandSchema.parse({
        command: 'create_page',
        requestId: crypto.randomUUID(),
        pageId: crypto.randomUUID(),
        type: 'persona',
        jdArea: harness.jdArea,
        parentId: null,
        status: 'suggested',
        ...draft,
      });
      const created = await createPage(db, actor, command, traceId, grounds.clock.now());
      if (created.ok) drafted += 1;
      else if (created.reason !== 'slug_taken') {
        const fields = {
          outcome: 'persona_draft_refused',
          slug: draft.slug,
          reason: created.reason,
        };
        grounds.logger.warn('a template persona was not drafted', fields);
      }
    }
    return { drafted, skipped: fixtures.length - drafted };
  };
}

export function commandCapabilities(grounds: CapabilityGrounds): CommandCapabilities {
  const { db } = grounds.database;
  const { actor } = grounds.caller;
  return {
    pages: {
      read: (pageId) => readPage(db, actor, pageId, grounds.clock.now()),
      draftPersonas: drafterOf(grounds),
    },
    githubIssues: { byNumber: (repository, number) => issueByNumber(db, repository, number) },
    importIssue: importerOf(grounds),
    gateKernel: gateKernelOf(grounds),
  };
}
