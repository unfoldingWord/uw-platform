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

export async function withoutWithheld(
  db: Executor,
  actor: Principal,
  page: Page,
  collectionId: string | null,
  at: Date,
): Promise<Page> {
  if (collectionId === null) return page;
  const withheld = await withheldKeys(db, actor, collectionId, at);
  if (withheld.size === 0) return page;
  const frontmatter = Object.fromEntries(
    Object.entries(page.frontmatter).filter(([key]) => !withheld.has(key)),
  );
  return { ...page, frontmatter };
}
