import { and, eq } from 'drizzle-orm';
import { createPageCommandSchema, type ErrorReason, type JdArea } from '@uw/contracts';
import type { Principal } from '@uw/core/principal';
import type { Database } from '@uw/db/client';
import { pgErrorCode } from '@uw/db/errors';
import { pages, pageVersions } from '@uw/db/schema';
import { createPage } from './store.ts';

export type InstructionsRequest = {
  readonly jdArea: JdArea;
  readonly title: string;
  readonly traceId: string;
  readonly at: Date;
};

export type InstructionsCreated =
  | { readonly ok: true; readonly pageId: string }
  | { readonly ok: false; readonly reason: ErrorReason };

function slugOf(title: string, pageId: string): string {
  const words = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/, '');
  return `${words === '' ? 'instructions' : words}-${pageId.slice(0, 8)}`;
}

export async function createInstructionsPage(
  db: Database,
  actor: Principal,
  request: InstructionsRequest,
): Promise<InstructionsCreated> {
  const { jdArea, title, traceId, at } = request;
  const pageId = crypto.randomUUID();
  const slug = slugOf(title, pageId);
  const command = createPageCommandSchema.parse({
    command: 'create_page',
    requestId: crypto.randomUUID(),
    pageId,
    type: 'skill',
    jdArea,
    slug,
    title,
    parentId: null,
    frontmatter: { name: slug.slice(0, 64).replace(/-+$/, ''), description: title },
    bodyMd: `# ${title}\n\nWrite what an agent at this stage should do.\n`,
    status: 'suggested',
  });
  const made = await createPage(db, actor, command, traceId, at);
  if (!made.ok) return { ok: false, reason: made.reason };
  return { ok: true, pageId };
}

const FOREIGN_KEY_VIOLATION = '23503';

export async function discardUnusedInstructionsPage(
  db: Database,
  pageId: string,
): Promise<boolean> {
  try {
    return await db.transaction(async (tx) => {
      const [fresh] = await tx
        .select({ id: pages.id })
        .from(pages)
        .where(and(eq(pages.id, pageId), eq(pages.version, 1), eq(pages.type, 'skill')))
        .for('update');
      if (fresh === undefined) return false;
      await tx.delete(pageVersions).where(eq(pageVersions.pageId, pageId));
      await tx.delete(pages).where(eq(pages.id, pageId));
      return true;
    });
  } catch (error) {
    if (pgErrorCode(error) === FOREIGN_KEY_VIOLATION) return false;
    throw error;
  }
}
