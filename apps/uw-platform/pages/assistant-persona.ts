import { and, eq } from 'drizzle-orm';
import type { JdArea } from '@uw/contracts';
import type { PersonaPageDraft } from '@uw/harness';
import type { Database } from '@uw/db/client';
import { pages } from '@uw/db/schema';
import type { WriteSource } from './collection-pages.ts';
import { snapshot } from './store.ts';

export type AssistantPersonaPage = {
  readonly pageId: string;
  readonly version: number;
  readonly status: string;
};

type NewAssistantPersona = {
  readonly pageId: string;
  readonly jdArea: JdArea;
  readonly draft: PersonaPageDraft;
};

async function bySlug(db: Database, jdArea: JdArea, slug: string) {
  const [row] = await db
    .select({ pageId: pages.id, version: pages.version, status: pages.status })
    .from(pages)
    .where(and(eq(pages.jdArea, jdArea), eq(pages.slug, slug), eq(pages.type, 'persona')));
  return row ?? null;
}

export async function suggestAssistantPersona(
  db: Database,
  page: NewAssistantPersona,
  source: WriteSource,
): Promise<AssistantPersonaPage> {
  const held = await bySlug(db, page.jdArea, page.draft.slug);
  if (held !== null) return held;
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(pages)
      .values({
        id: page.pageId,
        type: 'persona',
        jdArea: page.jdArea,
        slug: page.draft.slug,
        title: page.draft.title,
        parentId: null,
        frontmatter: { ...page.draft.frontmatter, status: 'suggested' },
        bodyMd: page.draft.bodyMd,
        version: 1,
        status: 'suggested',
        createdAt: source.at,
        updatedAt: source.at,
      })
      .returning();
    if (!row) throw new Error('an inserted persona page must return its row');
    await snapshot(tx, row, source.actor, source);
    return { pageId: row.id, version: row.version, status: row.status };
  });
}
