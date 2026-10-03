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
  | { readonly ok: true; readonly pageId: string }
  | { readonly ok: false; readonly reason: 'slug_taken' };

const ISSUE_PAGE = 'issue';
const titleLimit = 200;
const mirrorOf = z.object({ github_id: z.number() });

export function boundedTitle(title: string, fallback: string): string {
  const trimmed = title.trim();
  if (trimmed.length === 0) return fallback;
  const cut = trimmed.slice(0, titleLimit);
  const last = cut.charCodeAt(cut.length - 1);
  const split = cut.length === titleLimit && last >= 0xd800 && last <= 0xdbff;
  const kept = (split ? cut.slice(0, -1) : cut).trimEnd();
  return kept.length === 0 ? fallback : kept;
}

async function existing(tx: Transaction, input: IssuePageInput, slug: string) {
  const [row] = await tx
    .select({ id: pages.id, type: pages.type, frontmatter: pages.frontmatter })
    .from(pages)
    .where(and(eq(pages.jdArea, input.jdArea), eq(pages.slug, slug)));
  if (row === undefined) return null;
  const mirror = mirrorOf.safeParse(row.frontmatter);
  const same = row.type === ISSUE_PAGE && mirror.success;
  return same && mirror.data.github_id === input.issue.githubId
    ? { ok: true as const, pageId: row.id }
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
      .returning({ id: pages.id });
    if (row === undefined)
      return (await existing(tx, input, slug)) ?? { ok: false, reason: 'slug_taken' };
    const { id, ...snapshot } = page;
    await tx
      .insert(pageVersions)
      .values({ ...snapshot, pageId: id, editSource: input.editor, traceId });
    return { ok: true, pageId: id };
  });
}
