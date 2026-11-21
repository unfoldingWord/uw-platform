import { eq } from 'drizzle-orm';
import {
  knowledgeFrontmatterSchema,
  type ErrorReason,
  type JdArea,
  type PageCategory,
  type SetAreaHomeCommand,
} from '@uw/contracts';
import { can } from '@uw/core/acl';
import type { Principal } from '@uw/core/principal';
import type { Executor, Transaction } from '@uw/db/client';
import { areaHomes, pages } from '@uw/db/schema';
import { categoryCounts } from './categories.ts';
import { readPage, snapshotBy } from './store.ts';

type Done = { readonly ok: true } | { readonly ok: false; readonly reason: ErrorReason };

export type AreaHome = {
  readonly area: JdArea;
  readonly home: { readonly id: string; readonly title: string } | null;
  readonly categories: readonly PageCategory[];
};

async function homeRefusal(
  db: Executor,
  actor: Principal,
  command: SetAreaHomeCommand,
  at: Date,
): Promise<ErrorReason | null> {
  if (!can(actor, 'admin', { kind: 'area', area: command.area }, at)) return 'not_permitted';
  if (command.pageId === null) return null;
  const page = await readPage(db, actor, command.pageId, at);
  if (page === null || page.status === 'retired') return 'page_not_found';
  const filed = knowledgeFrontmatterSchema.safeParse(page.frontmatter);
  if (page.type !== 'knowledge' || !filed.success || page.jdArea !== command.area) {
    return 'invalid_frontmatter';
  }
  return null;
}

export async function setAreaHome(
  db: Executor,
  actor: Principal,
  command: SetAreaHomeCommand,
  at: Date,
): Promise<Done> {
  const refusal = await homeRefusal(db, actor, command, at);
  if (refusal !== null) return { ok: false, reason: refusal };
  if (command.pageId === null) {
    await db.delete(areaHomes).where(eq(areaHomes.area, command.area));
    return { ok: true };
  }
  const row = { area: command.area, pageId: command.pageId, setBy: actor.identity, setAt: at };
  await db.insert(areaHomes).values(row).onConflictDoUpdate({ target: areaHomes.area, set: row });
  return { ok: true };
}

export async function homePageOf(db: Executor, area: JdArea): Promise<string | null> {
  const [row] = await db
    .select({ pageId: areaHomes.pageId })
    .from(areaHomes)
    .innerJoin(pages, eq(pages.id, areaHomes.pageId))
    .where(eq(areaHomes.area, area));
  return row?.pageId ?? null;
}

export async function areaHome(
  db: Executor,
  actor: Principal,
  area: JdArea,
  at: Date,
): Promise<AreaHome | null> {
  if (!can(actor, 'read', { kind: 'area', area }, at)) return null;
  const pageId = await homePageOf(db, area);
  const page = pageId === null ? null : await readPage(db, actor, pageId, at);
  const live = page !== null && page.status !== 'retired' && page.jdArea === area;
  const categories = (await categoryCounts(db, actor, at)).filter((entry) => entry.area === area);
  return { area, home: live ? { id: page.id, title: page.title } : null, categories };
}

export type SeededHome = {
  readonly area: JdArea;
  readonly pageId: string;
  readonly category: string;
  readonly slug: string;
  readonly title: string;
  readonly bodyMd: string;
  readonly overview: string;
};

export async function seedAreaHome(
  tx: Transaction,
  home: SeededHome,
  by: string,
  at: Date,
): Promise<void> {
  if ((await homePageOf(tx, home.area)) !== null) return;
  const [taken] = await tx.select({ id: pages.id }).from(pages).where(eq(pages.id, home.pageId));
  if (taken !== undefined) return;
  const frontmatter = knowledgeFrontmatterSchema.parse({
    jd_category: home.category,
    overview: home.overview,
  });
  const [row] = await tx
    .insert(pages)
    .values({
      id: home.pageId,
      type: 'knowledge',
      jdArea: home.area,
      slug: home.slug,
      title: home.title,
      parentId: null,
      frontmatter,
      bodyMd: home.bodyMd,
      version: 1,
      status: 'active',
      createdAt: at,
      updatedAt: at,
    })
    .onConflictDoNothing()
    .returning();
  if (row === undefined) return;
  await snapshotBy(tx, row, by, { traceId: crypto.randomUUID(), requestId: null });
  await tx.insert(areaHomes).values({ area: home.area, pageId: home.pageId, setBy: by, setAt: at });
}
