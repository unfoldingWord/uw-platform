import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Identity, IssueRef, JdArea } from '@uw/contracts';
import type { Database, Transaction } from '@uw/db/client';
import { pages, pageVersions } from '@uw/db/schema';

export type IssuePageInput = {
  readonly jdArea: JdArea;
  readonly issue: IssueRef;
  readonly title: string;
  readonly url: string;
  readonly editor: Identity;
};

export type IssuePage =
  | { readonly ok: true; readonly pageId: string; readonly createdAt: Date }
  | { readonly ok: false; readonly reason: 'slug_taken' };

const ISSUE_PAGE = 'issue';
const titleLimit = 200;
const mirrorOf = z.object({ github_id: z.number(), url: z.string() });

export function boundedTitle(title: string, fallback: string): string {
  const trimmed = title.trim();
  if (trimmed.length === 0) return fallback;
  const cut = trimmed.slice(0, titleLimit);
  const last = cut.charCodeAt(cut.length - 1);
  const split = cut.length === titleLimit && last >= 0xd800 && last <= 0xdbff;
  const kept = (split ? cut.slice(0, -1) : cut).trimEnd();
  return kept.length === 0 ? fallback : kept;
}

async function firstEditor(tx: Transaction, pageId: string): Promise<string | null> {
  const [row] = await tx
    .select({ editSource: pageVersions.editSource })
    .from(pageVersions)
    .where(and(eq(pageVersions.pageId, pageId), eq(pageVersions.version, 1)));
  return row?.editSource ?? null;
}

async function existing(tx: Transaction, input: IssuePageInput, slug: string) {
  const [row] = await tx
    .select({
      id: pages.id,
      type: pages.type,
      frontmatter: pages.frontmatter,
      createdAt: pages.createdAt,
    })
    .from(pages)
    .where(and(eq(pages.jdArea, input.jdArea), eq(pages.slug, slug)));
  if (row === undefined) return null;
  const mirror = mirrorOf.safeParse(row.frontmatter);
  const matches =
    row.type === ISSUE_PAGE &&
    mirror.success &&
    mirror.data.github_id === input.issue.githubId &&
    mirror.data.url === input.url;
  const ours = matches && (await firstEditor(tx, row.id)) === input.editor;
  return ours
    ? { ok: true as const, pageId: row.id, createdAt: row.createdAt }
    : { ok: false as const, reason: 'slug_taken' as const };
}

function pageOf(input: IssuePageInput, id: string, slug: string) {
  const { issue } = input;
  return {
    id,
    type: ISSUE_PAGE,
    jdArea: input.jdArea,
    slug,
    title: boundedTitle(input.title, `${issue.repo}#${issue.number}`),
    parentId: null,
    frontmatter: {
      repo: issue.repo,
      number: issue.number,
      github_id: issue.githubId,
      url: input.url,
    },
    bodyMd: `Tracks [${issue.repo}#${issue.number}](${input.url}).`,
    version: 1,
    status: 'active',
  };
}

export function ensureIssuePage(
  db: Database,
  input: IssuePageInput,
  ids: { next(): string },
  traceId: string,
): Promise<IssuePage> {
  const slug = `issue-${input.issue.githubId}`;
  return db.transaction(async (tx) => {
    const found = await existing(tx, input, slug);
    if (found !== null) return found;
    const page = pageOf(input, ids.next(), slug);
    const [row] = await tx
      .insert(pages)
      .values(page)
      .onConflictDoNothing({ target: [pages.jdArea, pages.slug] })
      .returning({ id: pages.id, createdAt: pages.createdAt });
    if (row === undefined)
      return (await existing(tx, input, slug)) ?? { ok: false, reason: 'slug_taken' };
    const { id, ...snapshot } = page;
    await tx
      .insert(pageVersions)
      .values({ ...snapshot, pageId: id, editSource: input.editor, traceId });
    return { ok: true, pageId: id, createdAt: row.createdAt };
  });
}
