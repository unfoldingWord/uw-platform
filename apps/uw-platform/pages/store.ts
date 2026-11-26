import { and, eq, sql } from 'drizzle-orm';
import {
  isCollectionPageType,
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
import { derivedFrontmatter, personaLanding } from './derive.ts';
import { filedOutsideItsArea } from './filing.ts';
import { isGatedType, returnsToSuggested } from './gating.ts';
import { embedsItself, rebuildLinks, resolveBody } from './links.ts';
import { provenanceOf, type ExternalWriter } from './provenance.ts';
import { REPLAY_INDEX, replayOf } from './replay.ts';
import { withoutWithheld } from './property-rules.ts';
import { checkFrontmatter } from './validate.ts';

export const owns = [
  'pages',
  'page_versions',
  'jd_categories',
  'page_views',
  'page_links',
  'page_files',
  'page_favourites',
  'page_comments',
  'area_homes',
  'page_renders',
] as const;

export type PageResult =
  { readonly ok: true; readonly page: Page } | { readonly ok: false; readonly reason: ErrorReason };

export type PageRefusal = {
  readonly ok: false;
  readonly reason: ErrorReason;
  readonly detail: Readonly<Record<string, string | readonly string[]>>;
};

export type PageEffects = {
  readonly leftActive: (tx: Transaction, page: Page) => Promise<void>;
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

const collectionRow: PageRefusal = { ok: false, reason: 'collection_row', detail: {} };

const activationRequired: PageRefusal = { ok: false, reason: 'activation_required', detail: {} };

const ISSUE_MIRROR = 'issue';

const PROFILE = 'profile';

function writtenByItsRow(type: string): boolean {
  return type === PROFILE || isCollectionPageType(type);
}

const issueMirror: PageRefusal = {
  ok: false,
  reason: 'not_permitted',
  detail: { why: 'issue_mirror' },
};

function activates(type: string, from: PageStatus | null, to: PageStatus): boolean {
  return to === 'active' && from !== 'active' && isGatedType(type);
}

export function toPage(row: PageRow): Page {
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
  if (!can(actor, 'read', { kind: 'area', area: page.jdArea }, at)) return null;
  return withoutWithheld(db, actor, page, row.collectionId, at);
}

export type SnapshotSource = { readonly traceId: string; readonly requestId: string | null };

export function snapshot(tx: Transaction, row: PageRow, actor: Principal, source: SnapshotSource) {
  return snapshotBy(tx, row, actor.identity, source);
}

export async function snapshotBy(
  tx: Transaction,
  row: PageRow,
  editSource: string,
  source: SnapshotSource,
) {
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
    editSource,
    traceId: source.traceId,
    requestId: source.requestId,
  });
}

function conflictReason(error: unknown): ErrorReason | null {
  if (pgErrorCode(error) !== UNIQUE_VIOLATION) return null;
  const constraint = pgConstraint(error);
  if (constraint === PAGE_PRIMARY_KEY) return 'page_exists';
  if (constraint === SLUG_PER_AREA) return 'slug_taken';
  if (constraint === REPLAY_INDEX) return 'request_in_flight';
  return null;
}

export async function pageConflict(error: unknown): Promise<PageResult> {
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
  await snapshot(tx, row, actor, { traceId, requestId: command.requestId });
  return { ok: true, page: toPage(row) };
}

export type CreateRequest = {
  readonly traceId: string;
  readonly at: Date;
  readonly writer: ExternalWriter | null;
};

export function createPage(
  db: Database,
  actor: Principal,
  command: CreatePageCommand,
  traceId: string,
  at: Date,
): Promise<PageResult | PageRefusal> {
  return createPageAs(db, actor, command, { traceId, at, writer: null });
}

function reservedType(type: string): PageRefusal | null {
  if (type === ISSUE_MIRROR) return issueMirror;
  return writtenByItsRow(type) ? collectionRow : null;
}

function keptFrontmatter(stored: Page, command: CheckedSave['command']): CheckedSave['command'] {
  return isCollectionPageType(stored.type)
    ? { ...command, frontmatter: stored.frontmatter }
    : command;
}

export async function createPageAs(
  db: Database,
  actor: Principal,
  command: CreatePageCommand,
  request: CreateRequest,
): Promise<PageResult | PageRefusal> {
  const { traceId, at } = request;
  const replayed = await replayOf(db, actor, command.requestId);
  if (replayed !== null) return { ok: true, page: replayed };
  const reserved = reservedType(command.type);
  if (reserved !== null) return reserved;
  const check = checkFrontmatter(command.type, command.frontmatter);
  if (!check.ok) return refused(check.reason);
  if (filedOutsideItsArea(check.type, check.frontmatter, command.jdArea)) {
    return refused('invalid_frontmatter');
  }
  if (activates(command.type, null, command.status)) return activationRequired;
  if (!can(actor, 'write', { kind: 'area', area: command.jdArea }, at)) {
    return refused('not_permitted');
  }
  if (command.parentId !== null && (await readPage(db, actor, command.parentId, at)) === null) {
    return refused('parent_not_found');
  }
  try {
    return await db.transaction(async (tx) => {
      const landing = { status: command.status, stored: null, prior: null, writer: request.writer };
      const derived = await derivedFrontmatter(
        tx,
        check.type,
        check.frontmatter,
        command.frontmatter,
        landing,
      );
      if (!derived.ok) return refused(derived.reason);
      const bodyMd = await resolveBody(
        tx,
        actor,
        { bodyMd: command.bodyMd, area: command.jdArea },
        at,
      );
      if (await embedsItself(tx, command.pageId, bodyMd)) return refused('embed_cycle');
      const filled = { ...command, frontmatter: derived.frontmatter, bodyMd };
      const made = await insertPage(tx, actor, filled, traceId);
      if (made.ok) await rebuildLinks(tx, command.pageId, bodyMd);
      return made;
    });
  } catch (error) {
    return pageConflict(error);
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

export async function parentRefusal(
  tx: Transaction,
  actor: Principal,
  command: Pick<UpdatePageCommand, 'pageId' | 'parentId'>,
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
  await snapshot(tx, row, actor, { traceId, requestId: command.requestId });
  return { ok: true, page: toPage(row) };
}

export async function lockedPage(
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

async function derivedSave(
  tx: Transaction,
  stored: Page,
  chosen: PageStatus,
  command: CheckedSave['command'],
): Promise<UpdatePageCommand | PageResult> {
  const check = checkFrontmatter(stored.type, command.frontmatter);
  if (!check.ok) return refused(check.reason);
  if (filedOutsideItsArea(check.type, check.frontmatter, stored.jdArea)) {
    return refused('invalid_frontmatter');
  }
  const status = personaLanding(stored, chosen, check.frontmatter, command.bodyMd);
  const prior = stored.type === 'learning' ? provenanceOf(stored.frontmatter) : null;
  const landing = { status, stored: stored.status, prior, writer: null };
  const derived = await derivedFrontmatter(
    tx,
    check.type,
    check.frontmatter,
    command.frontmatter,
    landing,
  );
  if (!derived.ok) return refused(derived.reason);
  return { ...command, command: 'update_page', frontmatter: derived.frontmatter, status };
}

type Save = {
  readonly actor: Principal;
  readonly checked: CheckedSave;
  readonly traceId: string;
  readonly at: Date;
  readonly effects?: PageEffects;
};

async function writeLinked(
  tx: Transaction,
  save: Save,
  stored: Page,
  full: UpdatePageCommand,
): Promise<PageResult> {
  const { actor, traceId, at } = save;
  const bodyMd = await resolveBody(tx, actor, { bodyMd: full.bodyMd, area: stored.jdArea }, at);
  if (await embedsItself(tx, stored.id, bodyMd)) return refused('embed_cycle');
  const saved = await writeUpdate(tx, actor, { ...full, bodyMd }, traceId);
  if (saved.ok) await rebuildLinks(tx, stored.id, bodyMd);
  return saved;
}

function statusOf(checked: CheckedSave, stored: Page): PageStatus | PageRefusal {
  return stored.type === PROFILE ? collectionRow : checked.statusFor(stored);
}

async function withEffects(
  tx: Transaction,
  save: Save,
  stored: Page,
  saved: PageResult,
): Promise<PageResult> {
  const left = saved.ok && stored.status === 'active' && saved.page.status !== 'active';
  if (left && save.effects !== undefined) await save.effects.leftActive(tx, saved.page);
  return saved;
}

async function updateInTransaction(tx: Transaction, save: Save): Promise<PageResult | PageRefusal> {
  const { actor, checked, at } = save;
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
  const chosen = statusOf(checked, stored);
  if (typeof chosen !== 'string') return chosen;
  const full = await derivedSave(tx, stored, chosen, keptFrontmatter(stored, command));
  if ('ok' in full) return full;
  const blocked = await parentRefusal(tx, actor, full, at);
  if (blocked !== null) return refused(blocked);
  return withEffects(tx, save, stored, await writeLinked(tx, save, stored, full));
}

async function saveChecked(db: Database, save: Save): Promise<PageResult | PageRefusal> {
  const replayed = await replayOf(db, save.actor, save.checked.command.requestId);
  if (replayed !== null) return { ok: true, page: replayed };
  try {
    return await db.transaction((tx) => updateInTransaction(tx, save));
  } catch (error) {
    return pageConflict(error);
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

export type UpdateRequest = {
  readonly traceId: string;
  readonly at: Date;
  readonly effects?: PageEffects;
};

export function updatePageWith(
  db: Database,
  actor: Principal,
  command: UpdatePageCommand,
  request: UpdateRequest,
): Promise<PageResult | PageRefusal> {
  const statusFor = (stored: Page): PageStatus | PageRefusal => {
    if (stored.type === ISSUE_MIRROR) return issueMirror;
    if (returnsToSuggested(stored.type, stored.status, command.status)) return 'suggested';
    return activates(stored.type, stored.status, command.status)
      ? activationRequired
      : command.status;
  };
  return saveChecked(db, { actor, checked: { command, statusFor }, ...request });
}

export function updatePage(
  db: Database,
  actor: Principal,
  command: UpdatePageCommand,
  traceId: string,
  at: Date,
): Promise<PageResult | PageRefusal> {
  return updatePageWith(db, actor, command, { traceId, at });
}
