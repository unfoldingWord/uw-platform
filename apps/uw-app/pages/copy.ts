import { createPageCommandSchema, type Page } from '@uw/contracts';
import type { Principal } from '@uw/core/principal';
import type { Database } from '@uw/db/client';
import { createPage, type PageRefusal, type PageResult } from './store.ts';

const MOST_SLUG = 60;

export function slugFor(title: string, pageId: string): string {
  const plain = title
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, MOST_SLUG)
    .replace(/^-+|-+$/g, '');
  return `${plain === '' ? 'page' : plain}-${pageId.slice(0, 8)}`;
}

type Request = { readonly requestId: unknown; readonly traceId: string; readonly at: Date };

export async function copyPage(
  db: Database,
  actor: Principal,
  page: Page,
  request: Request,
): Promise<PageResult | PageRefusal> {
  const pageId = crypto.randomUUID();
  const title = `Copy of ${page.title}`.slice(0, 200);
  const command = createPageCommandSchema.safeParse({
    command: 'create_page',
    requestId: request.requestId,
    pageId,
    type: page.type,
    jdArea: page.jdArea,
    slug: slugFor(title, pageId),
    title,
    parentId: page.parentId,
    frontmatter: { ...page.frontmatter, jd_id: null, aliases: [] },
    bodyMd: page.bodyMd,
    status: 'active',
  });
  if (!command.success) return { ok: false, reason: 'malformed_command' };
  return createPage(db, actor, command.data, request.traceId, request.at);
}
