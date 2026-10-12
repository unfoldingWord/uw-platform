import { and, eq, ne, sql } from 'drizzle-orm';
import { personaFrontmatterSchema, type Identity } from '@uw/contracts';
import type { AnyExecutor } from '../any-database.ts';
import { pages, personas } from '../schema.ts';
import { factColumns, toFacts } from './pages.ts';
import { refusing } from './refusal.ts';
import type { PageFacts, PersonaRow, PersonasGateway } from './types.ts';

async function byIdentity(executor: AnyExecutor, identity: Identity): Promise<PersonaRow | null> {
  const [row] = await executor.select().from(personas).where(eq(personas.identity, identity));
  if (row === undefined) return null;
  return { identity, harnessId: row.harnessId, pageId: row.pageId };
}

async function active(
  executor: AnyExecutor,
  identity: Identity,
  harnessId: string,
): Promise<PageFacts | null> {
  const [row] = await executor
    .select(factColumns)
    .from(personas)
    .innerJoin(pages, eq(pages.id, personas.pageId))
    .where(
      and(
        eq(personas.identity, identity),
        eq(personas.harnessId, harnessId),
        eq(pages.type, 'persona'),
        eq(pages.status, 'active'),
        eq(sql`${pages.frontmatter}->>'identity'`, personas.identity),
        eq(sql`${pages.frontmatter}->>'harness'`, sql`${personas.harnessId}::text`),
      ),
    );
  if (row === undefined) return null;
  if (!personaFrontmatterSchema.safeParse(row.frontmatter).success) return null;
  return toFacts(row);
}

async function upsert(executor: AnyExecutor, row: PersonaRow): Promise<void> {
  await executor
    .delete(personas)
    .where(and(eq(personas.pageId, row.pageId), ne(personas.identity, row.identity)));
  await executor
    .insert(personas)
    .values({ identity: row.identity, harnessId: row.harnessId, pageId: row.pageId })
    .onConflictDoUpdate({
      target: personas.identity,
      set: { harnessId: row.harnessId, pageId: row.pageId },
    });
}

export function bindPersonas(executor: AnyExecutor): PersonasGateway {
  return {
    read: {
      byIdentity: (identity) => byIdentity(executor, identity),
      active: (identity, harnessId) => active(executor, identity, harnessId),
    },
    write: { upsert: (row) => refusing(() => upsert(executor, row)) },
  };
}
