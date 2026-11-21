import { and, eq, lt, ne } from 'drizzle-orm';
import type { Page } from '@uw/contracts';
import type { Executor } from '@uw/db/client';
import { pageRenders } from '@uw/db/schema';
import type { EmbedSource } from '../markdown/page-refs.ts';
import type { Heading, Rendered } from '../markdown/render.ts';
import type { Resolved } from '../markdown/wiki-syntax.ts';
import type { FileKind } from '../markdown/file-media.ts';

const KEPT_MS = 7 * 24 * 60 * 60 * 1000;

export type RenderInputs = {
  readonly revision: string;
  readonly page: Page;
  readonly embeds: ReadonlyMap<string, EmbedSource>;
  readonly titles: ReadonlyMap<string, string>;
  readonly wiki: ReadonlyMap<string, Resolved | null>;
  readonly files?: ReadonlyMap<string, FileKind>;
};

function sorted<V>(map: ReadonlyMap<string, V>): (readonly [string, V])[] {
  return [...map].sort(([a], [b]) => a.localeCompare(b));
}

export async function renderKey(inputs: RenderInputs): Promise<string> {
  const described = JSON.stringify({
    revision: inputs.revision,
    page: [inputs.page.id, inputs.page.version, inputs.page.bodyMd],
    embeds: sorted(inputs.embeds),
    titles: sorted(inputs.titles),
    wiki: sorted(inputs.wiki),
    files: sorted(inputs.files ?? new Map()),
  });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(described));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function cachedRender(
  db: Executor,
  pageId: string,
  key: string,
): Promise<Rendered | null> {
  const [row] = await db
    .select({ html: pageRenders.html, headings: pageRenders.headings })
    .from(pageRenders)
    .where(and(eq(pageRenders.pageId, pageId), eq(pageRenders.key, key)));
  if (row === undefined) return null;
  return { html: row.html, headings: row.headings as readonly Heading[] };
}

export async function keepRender(
  db: Executor,
  entry: { readonly page: Page; readonly key: string; readonly at: Date },
  rendered: Rendered,
): Promise<void> {
  const { page, key, at } = entry;
  await db
    .insert(pageRenders)
    .values({
      pageId: page.id,
      key,
      version: page.version,
      html: rendered.html,
      headings: rendered.headings,
      renderedAt: at,
    })
    .onConflictDoNothing();
  const stale = new Date(at.getTime() - KEPT_MS);
  await db
    .delete(pageRenders)
    .where(
      and(
        eq(pageRenders.pageId, page.id),
        ne(pageRenders.key, key),
        lt(pageRenders.renderedAt, stale),
      ),
    );
}
