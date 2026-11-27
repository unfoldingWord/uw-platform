import type { CollectionRow } from '@uw/contracts';
import { can } from '@uw/core/acl';
import type { Principal } from '@uw/core/principal';
import { and, eq, inArray } from 'drizzle-orm';
import type { Executor } from '@uw/db/client';
import { pages } from '@uw/db/schema';
import { loadCollection } from '../collections/definitions.ts';
import { viewRows } from '../collections/replies.ts';

export type MeasuredResource = {
  readonly resourceId: string;
  readonly title: string;
  readonly address: string;
  readonly area: string;
};

const RESOURCES_COLLECTION = 'resource';
const RESOURCE_PAGE = 'resource';
const PAGE_SIZE = 200;
const MOST_PAGES = 5;

type Listed = Omit<MeasuredResource, 'address'>;

function listedOf(row: CollectionRow): Listed | null {
  if (row.jdArea === null) return null;
  return { resourceId: row.id, title: row.title, area: row.jdArea };
}

function addressIn(frontmatter: unknown): string {
  if (frontmatter === null || typeof frontmatter !== 'object') return '';
  const address: unknown = Object.entries(frontmatter).find(([key]) => key === 'address')?.[1];
  return typeof address === 'string' ? address : '';
}

async function withAddresses(
  db: Executor,
  listed: readonly Listed[],
): Promise<readonly MeasuredResource[]> {
  if (listed.length === 0) return [];
  const rows = await db
    .select({ id: pages.id, frontmatter: pages.frontmatter })
    .from(pages)
    .where(
      inArray(
        pages.id,
        listed.map((each) => each.resourceId),
      ),
    );
  const addresses = new Map(rows.map((row) => [row.id, addressIn(row.frontmatter)]));
  return listed.map((each) => ({ ...each, address: addresses.get(each.resourceId) ?? '' }));
}

async function listedOfView(
  db: Executor,
  actor: Principal,
  request: { readonly viewId: string; readonly most: number },
  at: Date,
): Promise<readonly Listed[] | null> {
  const stored = await loadCollection(db, RESOURCES_COLLECTION);
  if (stored === null) return null;
  const found: Listed[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < MOST_PAGES && found.length < request.most; page += 1) {
    const read = await viewRows(db, stored, actor, at, {
      viewId: request.viewId,
      limit: PAGE_SIZE,
      cursor,
    });
    if (!read.ok) return page === 0 ? null : found.slice(0, request.most);
    found.push(...read.value.rows.flatMap((row) => listedOf(row) ?? []));
    cursor = read.value.next;
    if (cursor === null) break;
  }
  return found.slice(0, request.most);
}

export async function resourcesOfView(
  db: Executor,
  actor: Principal,
  request: { readonly viewId: string; readonly most: number },
  at: Date,
): Promise<readonly MeasuredResource[] | null> {
  const listed = await listedOfView(db, actor, request, at);
  return listed === null ? null : withAddresses(db, listed);
}

export async function resourceIdsOfView(
  db: Executor,
  actor: Principal,
  request: { readonly viewId: string; readonly most: number },
  at: Date,
): Promise<readonly string[]> {
  const listed = await listedOfView(db, actor, request, at);
  return (listed ?? []).map((each) => each.resourceId);
}

export async function readableResource(
  db: Executor,
  actor: Principal,
  resourceId: string,
  at: Date,
): Promise<MeasuredResource | null> {
  const [row] = await db
    .select({ title: pages.title, area: pages.jdArea, frontmatter: pages.frontmatter })
    .from(pages)
    .where(and(eq(pages.id, resourceId), eq(pages.type, RESOURCE_PAGE)));
  if (row === undefined) return null;
  if (!can(actor, 'read', { kind: 'area', area: row.area }, at)) return null;
  const address = addressIn(row.frontmatter);
  return { resourceId, title: row.title, address, area: row.area };
}
