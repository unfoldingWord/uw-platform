import { and, asc, eq, gt, inArray, isNull, lte, ne, or, sql } from 'drizzle-orm';
import {
  assistantIdentityOf,
  assistantProvisioningFailureSchema,
  assistantProvisioningStatusSchema,
  assistantProvisioningStepSchema,
  type AssistantProvisioningFailure,
  type AssistantProvisioningStatus,
  type AssistantProvisioningStep,
} from '@uw/contracts';
import type { Executor } from '@uw/db/client';
import {
  assistantAccounts,
  assistantProvisioning,
  delegations,
  harnesses,
  pages,
  people,
  personas,
} from '@uw/db/schema';

export type AccountWork = {
  readonly harnessId: string;
  readonly personId: string;
  readonly personEmail: string;
  readonly name: string;
  readonly status: 'enabled' | 'disabled';
  readonly version: number;
};

export type Progress = {
  readonly harnessId: string;
  readonly personId: string;
  readonly accountVersion: number;
  readonly step: AssistantProvisioningStep;
  readonly status: AssistantProvisioningStatus;
  readonly failure: AssistantProvisioningFailure | null;
  readonly attempts: number;
  readonly nextAt: Date;
  readonly updatedAt: Date;
};

const READ_MOST = 50;

const workColumns = {
  harnessId: assistantAccounts.harnessId,
  personId: assistantAccounts.personId,
  personEmail: people.email,
  name: assistantAccounts.name,
  status: assistantAccounts.status,
  version: assistantAccounts.version,
};

function workOf(row: { status: string } & Omit<AccountWork, 'status'>): AccountWork | null {
  if (row.status !== 'enabled' && row.status !== 'disabled') return null;
  return { ...row, status: row.status };
}

function bounded(limit: number): number {
  return Math.max(1, Math.min(READ_MOST, Math.trunc(limit)));
}

export async function dueWork(db: Executor, now: Date, limit: number): Promise<AccountWork[]> {
  const stale = ne(assistantProvisioning.accountVersion, assistantAccounts.version);
  const rows = await db
    .select(workColumns)
    .from(assistantAccounts)
    .innerJoin(people, eq(people.id, assistantAccounts.personId))
    .leftJoin(
      assistantProvisioning,
      eq(assistantProvisioning.harnessId, assistantAccounts.harnessId),
    )
    .where(
      and(
        inArray(assistantAccounts.status, ['enabled', 'disabled']),
        or(
          isNull(assistantProvisioning.harnessId),
          stale,
          and(ne(assistantProvisioning.status, 'done'), lte(assistantProvisioning.nextAt, now)),
        ),
      ),
    )
    .orderBy(sql`${assistantProvisioning.nextAt} ASC NULLS FIRST`, asc(assistantAccounts.updatedAt))
    .limit(bounded(limit));
  return rows.flatMap((row) => workOf(row) ?? []);
}

export async function accountWork(db: Executor, harnessId: string): Promise<AccountWork | null> {
  const rows = await db
    .select(workColumns)
    .from(assistantAccounts)
    .innerJoin(people, eq(people.id, assistantAccounts.personId))
    .where(eq(assistantAccounts.harnessId, harnessId));
  return rows[0] ? workOf(rows[0]) : null;
}

export async function disabledSince(
  db: Executor,
  before: Date,
  limit: number,
): Promise<AccountWork[]> {
  const rows = await db
    .select(workColumns)
    .from(assistantAccounts)
    .innerJoin(people, eq(people.id, assistantAccounts.personId))
    .where(and(eq(assistantAccounts.status, 'disabled'), lte(assistantAccounts.disabledAt, before)))
    .orderBy(asc(assistantAccounts.disabledAt))
    .limit(bounded(limit));
  return rows.flatMap((row) => workOf(row) ?? []);
}

export async function progressOf(db: Executor, harnessId: string): Promise<Progress | null> {
  const rows = await db
    .select()
    .from(assistantProvisioning)
    .where(eq(assistantProvisioning.harnessId, harnessId));
  const row = rows[0];
  if (row === undefined) return null;
  return {
    ...row,
    step: assistantProvisioningStepSchema.parse(row.step),
    status: assistantProvisioningStatusSchema.parse(row.status),
    failure: row.failure === null ? null : assistantProvisioningFailureSchema.parse(row.failure),
  };
}

export async function putProgress(db: Executor, progress: Progress): Promise<void> {
  const { accountVersion, step, status, failure, attempts, nextAt, updatedAt } = progress;
  await db.insert(assistantProvisioning).values(progress).onConflictDoUpdate({
    target: assistantProvisioning.harnessId,
    set: { accountVersion, step, status, failure, attempts, nextAt, updatedAt },
  });
}

export type PersonaState =
  | { readonly kind: 'active' }
  | { readonly kind: 'suggested'; readonly pageId: string; readonly version: number }
  | { readonly kind: 'none' };

export async function personaState(db: Executor, work: AccountWork): Promise<PersonaState> {
  const identity = assistantIdentityOf(work.personId);
  const active = await db
    .select({ pageId: personas.pageId })
    .from(personas)
    .innerJoin(pages, eq(pages.id, personas.pageId))
    .where(
      and(
        eq(personas.identity, identity),
        eq(personas.harnessId, work.harnessId),
        eq(pages.status, 'active'),
      ),
    );
  if (active.length > 0) return { kind: 'active' };
  const drafts = await db
    .select({ pageId: pages.id, version: pages.version })
    .from(pages)
    .where(
      and(
        eq(pages.type, 'persona'),
        eq(pages.status, 'suggested'),
        sql`${pages.frontmatter}->>'harness' = ${work.harnessId}`,
        sql`${pages.frontmatter}->>'identity' = ${identity}`,
      ),
    )
    .orderBy(asc(pages.createdAt));
  const draft = drafts[0];
  return draft === undefined ? { kind: 'none' } : { kind: 'suggested', ...draft };
}

export async function assistLive(db: Executor, work: AccountWork, at: Date): Promise<boolean> {
  const rows = await db
    .select({ id: delegations.id })
    .from(delegations)
    .where(
      and(
        eq(delegations.harnessId, work.harnessId),
        eq(delegations.personId, work.personId),
        eq(delegations.capability, 'assist'),
        isNull(delegations.revokedAt),
        isNull(delegations.lapsedAt),
        gt(delegations.expiresAt, at),
      ),
    )
    .limit(1);
  return rows.length === 1;
}

export async function harnessAreaOf(db: Executor, harnessId: string): Promise<string | null> {
  const rows = await db
    .select({ jdArea: harnesses.jdArea })
    .from(harnesses)
    .where(eq(harnesses.id, harnessId));
  return rows[0]?.jdArea ?? null;
}

export type HeldAccount = {
  readonly harnessId: string;
  readonly name: string;
  readonly live: boolean;
};

export async function heldAccount(db: Executor, personId: string): Promise<HeldAccount | null> {
  const rows = await db
    .select({
      harnessId: assistantAccounts.harnessId,
      name: assistantAccounts.name,
      status: assistantAccounts.status,
    })
    .from(assistantAccounts)
    .where(eq(assistantAccounts.personId, personId));
  const row = rows[0];
  return row === undefined ? null : { ...row, live: row.status !== 'deleted' };
}
