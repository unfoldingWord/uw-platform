import { and, eq, ne } from 'drizzle-orm';
import { propertyRuleSchema, type Page } from '@uw/contracts';
import { propertyAccess } from '@uw/core/acl';
import type { Principal } from '@uw/core/principal';
import type { Executor } from '@uw/db/client';
import { collectionProperties, collections } from '@uw/db/schema';

async function withheldKeys(
  db: Executor,
  actor: Principal,
  collectionId: string,
  at: Date,
): Promise<ReadonlySet<string>> {
  const rows = await db
    .select({
      key: collectionProperties.key,
      definition: collectionProperties.definition,
      area: collections.jdArea,
    })
    .from(collectionProperties)
    .innerJoin(collections, eq(collections.id, collectionProperties.collectionId))
    .where(
      and(
        eq(collectionProperties.collectionId, collectionId),
        ne(collectionProperties.classification, 'internal'),
      ),
    );
  const withheld = rows.filter((row) => {
    const rule = propertyRuleSchema.safeParse((row.definition as { rule?: unknown }).rule);
    return !rule.success || propertyAccess(actor, rule.data, row.area, at) !== 'all';
  });
  return new Set(withheld.map((row) => row.key));
}

export type ShownPage = { readonly page: Page; readonly withheld: boolean };

export async function shownFields(
  db: Executor,
  actor: Principal,
  page: Page,
  collectionId: string | null,
  at: Date,
): Promise<ShownPage> {
  if (collectionId === null) return { page, withheld: false };
  const withheld = await withheldKeys(db, actor, collectionId, at);
  const entries = Object.entries(page.frontmatter);
  const kept = entries.filter(([key]) => !withheld.has(key));
  if (kept.length === entries.length) return { page, withheld: false };
  return { page: { ...page, frontmatter: Object.fromEntries(kept) }, withheld: true };
}

export async function withoutWithheld(
  db: Executor,
  actor: Principal,
  page: Page,
  collectionId: string | null,
  at: Date,
): Promise<Page> {
  return (await shownFields(db, actor, page, collectionId, at)).page;
}
