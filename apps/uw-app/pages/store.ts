import { and, eq, sql } from 'drizzle-orm';
import {
  pageSchema,
  type CreatePageCommand,
  type ErrorReason,
  type Page,
  type PageStatus,
  type UpdatePageCommand,
} from '@uw/contracts';
import { can } from '@uw/core/acl';
import type { Principal } from '@uw/core/principal';
import { advisoryLock, advisoryLocks } from '@uw/db/advisory-locks';
import type { Database, Executor, Transaction } from '@uw/db/client';
import { pages, pageVersions } from '@uw/db/schema';
import { pgConstraint, pgErrorCode } from '@uw/db/errors';
import { isGatedType } from './gating.ts';
import { checkFrontmatter } from './validate.ts';

export const owns = ['pages', 'page_versions'] as const;

export type PageResult =
  { readonly ok: true; readonly page: Page } | { readonly ok: false; readonly reason: ErrorReason };

export type PageRefusal = {
  readonly ok: false;
  readonly reason: ErrorReason;
  readonly detail: Readonly<Record<string, string | readonly string[]>>;
};

type CheckedSave = {
  readonly command: Omit<UpdatePageCommand, 'status'>;
  readonly statusFor: (stored: Page) => PageStatus | PageRefusal;
};

type PageRow = typeof pages.$inferSelect;

const UNIQUE_VIOLATION = '23505';
const PAGE_PRIMARY_KEY = 'pages_pkey';
const SLUG_PER_AREA = 'pages_slug_per_area';

function refused(reason: ErrorReason): PageResult {
  return { ok: false, reason };
}

const activationRequired: PageRefusal = {
  ok: false,
  reason: 'not_permitted',
  detail: { why: 'activation_required' },
};

function activates(type: string, from: PageStatus | null, to: PageStatus): boolean {
  return to === 'active' && from !== 'active' && isGatedType(type);
}

function toPage(row: PageRow): Page {
  return pageSchema.parse({
    id: row.id,
    type: row.type,
    jdArea: row.jdArea,
    slug: row.slug,
    title: row.title,
    parentId: row.parentId,
    frontmatter: row.frontmatter,
    bodyMd: row.bodyMd,
    version: row.version,
    status: row.status,
  });
}

export async function readPage(
  db: Executor,
  actor: Principal,
  pageId: string,
  at: Date,
): Promise<Page | null> {
  const [row] = await db.select().from(pages).where(eq(pages.id, pageId));
  if (!row) return null;
  const page = toPage(row);
  return can(actor, 'read', { kind: 'area', area: page.jdArea }, at) ? page : null;
}

async function snapshot(tx: Transaction, row: PageRow, actor: Principal, traceId: string) {
  await tx.insert(pageVersions).values({
    pageId: row.id,
    version: row.version,
    type: row.type,
    jdArea: row.jdArea,
    slug: row.slug,
    title: row.title,
    parentId: row.parentId,
    frontmatter: row.frontmatter,
    bodyMd: row.bodyMd,
    status: row.status,
    editSource: actor.identity,
    traceId,
  });
}

function conflictReason(error: unknown): ErrorReason | null {
  if (pgErrorCode(error) !== UNIQUE_VIOLATION) return null;
  const constraint = pgConstraint(error);
  if (constraint === PAGE_PRIMARY_KEY) return 'page_exists';
  if (constraint === SLUG_PER_AREA) return 'slug_taken';
  return null;
}

async function refusalOrThrow(error: unknown): Promise<PageResult> {
  const reason = conflictReason(error);
  if (reason === null) throw error;
  return refused(reason);
}

async function insertPage(
  tx: Transaction,
  actor: Principal,
  command: CreatePageCommand,
  traceId: string,
): Promise<PageResult> {
  const [row] = await tx
    .insert(pages)
    .values({
      id: command.pageId,
      type: command.type,
      jdArea: command.jdArea,
      slug: command.slug,
      title: command.title,
      parentId: command.parentId,
      frontmatter: command.frontmatter,
      bodyMd: command.bodyMd,
      version: 1,
      status: command.status,
    })
    .returning();
  if (!row) throw new Error('an inserted page must return its row');
  await snapshot(tx, row, actor, traceId);
  return { ok: true, page: toPage(row) };
}

export async function createPage(
  db: Database,
  actor: Principal,
  command: CreatePageCommand,
  traceId: string,
  at: Date,
): Promise<PageResult | PageRefusal> {
  const check = checkFrontmatter(command.type, command.frontmatter);
  if (!check.ok) return refused(check.reason);
  if (activates(command.type, null, command.status)) return activationRequired;
  if (!can(actor, 'write', { kind: 'area', area: command.jdArea }, at)) {
    return refused('not_permitted');
  }
  if (command.parentId !== null && (await readPage(db, actor, command.parentId, at)) === null) {
    return refused('parent_not_found');
  }
  try {
    return await db.transaction((tx) => insertPage(tx, actor, command, traceId));
  } catch (error) {
    return refusalOrThrow(error);
  }
}

async function ancestorChainReaches(
  tx: Transaction,
  parentId: string,
  pageId: string,
): Promise<boolean> {
  const rows = await tx.execute(sql`
    WITH RECURSIVE chain(id, parent_id) AS (
      SELECT id, parent_id FROM pages WHERE id = ${parentId}
      UNION
      SELECT p.id, p.parent_id FROM pages p JOIN chain c ON p.id = c.parent_id
    )
    SELECT 1 FROM chain WHERE id = ${pageId} LIMIT 1`);
  return rows.length > 0;
}

async function parentRefusal(
  tx: Transaction,
  actor: Principal,
  command: UpdatePageCommand,
  at: Date,
): Promise<ErrorReason | null> {
  if (command.parentId === null) return null;
  if (command.parentId === command.pageId) return 'parent_cycle';
  if ((await readPage(tx, actor, command.parentId, at)) === null) return 'parent_not_found';
  if (await ancestorChainReaches(tx, command.parentId, command.pageId)) return 'parent_cycle';
  return null;
}

async function writeUpdate(
  tx: Transaction,
  actor: Principal,
  command: UpdatePageCommand,
  traceId: string,
): Promise<PageResult> {
  const [row] = await tx
    .update(pages)
    .set({
      slug: command.slug,
      title: command.title,
      parentId: command.parentId,
      frontmatter: command.frontmatter,
      bodyMd: command.bodyMd,
      status: command.status,
      version: command.expectedVersion + 1,
      updatedAt: sql`now()`,
    })
    .where(and(eq(pages.id, command.pageId), eq(pages.version, command.expectedVersion)))
    .returning();
  if (!row) return refused('stale_version');
  await snapshot(tx, row, actor, traceId);
  return { ok: true, page: toPage(row) };
}

async function lockedPage(
  tx: Transaction,
  actor: Principal,
  pageId: string,
  at: Date,
): Promise<Page | null> {
  const [row] = await tx.select().from(pages).where(eq(pages.id, pageId)).for('update');
  if (!row) return null;
  const page = toPage(row);
  return can(actor, 'read', { kind: 'area', area: page.jdArea }, at) ? page : null;
}

async function movesParent(
  tx: Transaction,
  command: Pick<UpdatePageCommand, 'pageId' | 'parentId'>,
): Promise<boolean> {
  if (command.parentId === null) return false;
  const [row] = await tx
    .select({ parentId: pages.parentId })
    .from(pages)
    .where(eq(pages.id, command.pageId));
  return row?.parentId !== command.parentId;
}

type Save = {
  readonly actor: Principal;
  readonly checked: CheckedSave;
  readonly traceId: string;
  readonly at: Date;
};

async function updateInTransaction(tx: Transaction, save: Save): Promise<PageResult | PageRefusal> {
  const { actor, checked, traceId, at } = save;
  const { command } = checked;
  const reparents = await movesParent(tx, command);
  if (reparents) await tx.execute(advisoryLock(advisoryLocks.pageReparenting));
  const stored = await lockedPage(tx, actor, command.pageId, at);
  if (!stored) return refused('page_not_found');
  if (!reparents && command.parentId !== null && stored.parentId !== command.parentId) {
    return refused('stale_version');
  }
  if (!can(actor, 'write', { kind: 'area', area: stored.jdArea }, at)) {
    return refused('not_permitted');
  }
  const status = checked.statusFor(stored);
  if (typeof status !== 'string') return status;
  const check = checkFrontmatter(stored.type, command.frontmatter);
  if (!check.ok) return refused(check.reason);
  const full = { ...command, status };
  const blocked = await parentRefusal(tx, actor, full, at);
  if (blocked !== null) return refused(blocked);
  return writeUpdate(tx, actor, full, traceId);
}

async function saveChecked(db: Database, save: Save): Promise<PageResult | PageRefusal> {
  try {
    return await db.transaction((tx) => updateInTransaction(tx, save));
  } catch (error) {
    return refusalOrThrow(error);
  }
}

export function updateCheckedPage(
  db: Database,
  actor: Principal,
  checked: CheckedSave,
  traceId: string,
  at: Date,
): Promise<PageResult | PageRefusal> {
  return saveChecked(db, { actor, checked, traceId, at });
}

export async function updatePage(
  db: Database,
  actor: Principal,
  command: UpdatePageCommand,
  traceId: string,
  at: Date,
): Promise<PageResult | PageRefusal> {
  const statusFor = (stored: Page): PageStatus | PageRefusal =>
    activates(stored.type, stored.status, command.status) ? activationRequired : command.status;
  return saveChecked(db, { actor, checked: { command, statusFor }, traceId, at });
}
