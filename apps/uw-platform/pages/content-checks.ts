import { and, eq, inArray, ne } from 'drizzle-orm';
import type { ErrorReason } from '@uw/contracts';
import { can } from '@uw/core/acl';
import type { Principal } from '@uw/core/principal';
import type { Executor } from '@uw/db/client';
import { pages } from '@uw/db/schema';
import { appliesToNode, missingSections } from './validate.ts';

const targetTypes = ['portfolio', 'program', 'project', 'product'] as const;

export type ContentRefusal = {
  readonly ok: false;
  readonly reason: ErrorReason;
  readonly detail: Readonly<Record<string, string | readonly string[]>>;
};

export type CheckedContent = {
  readonly type: string;
  readonly frontmatter: Readonly<Record<string, unknown>>;
  readonly bodyMd: string;
};

function appliesToOf(content: CheckedContent): string | null {
  if (!appliesToNode(content.type)) return null;
  const target = content.frontmatter['applies_to'];
  return typeof target === 'string' ? target : null;
}

async function targetReadable(
  db: Executor,
  actor: Principal,
  targetId: string,
  at: Date,
): Promise<boolean> {
  const [row] = await db
    .select({ jdArea: pages.jdArea })
    .from(pages)
    .where(
      and(
        eq(pages.id, targetId),
        inArray(pages.type, [...targetTypes]),
        ne(pages.status, 'retired'),
      ),
    );
  return row !== undefined && can(actor, 'read', { kind: 'area', area: row.jdArea }, at);
}

export async function contentRefusal(
  db: Executor,
  actor: Principal,
  content: CheckedContent,
  at: Date,
): Promise<ContentRefusal | null> {
  const missing = missingSections(content.type, content.bodyMd);
  if (missing.length > 0) {
    return { ok: false, reason: 'charter_sections_missing', detail: { missing } };
  }
  const target = appliesToOf(content);
  if (target === null || (await targetReadable(db, actor, target, at))) return null;
  return { ok: false, reason: 'applies_to_not_found', detail: { appliesTo: target } };
}
