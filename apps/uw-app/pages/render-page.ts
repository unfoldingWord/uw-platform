import { and, eq, inArray } from 'drizzle-orm';
import type { Page } from '@uw/contracts';
import { can } from '@uw/core/acl';
import type { Principal } from '@uw/core/principal';
import type { Executor } from '@uw/db/client';
import { pageVersions, pages } from '@uw/db/schema';
import type { EmbedSource, RenderHooks } from '../markdown/page-refs.ts';
import { renderMarkdown, type Rendered } from '../markdown/render.ts';
import { pageRefs, wikiRefs } from '../markdown/wiki-syntax.ts';
import { resolverFor } from './links.ts';

type Reader = { readonly actor: Principal; readonly at: Date };
type Titles = { readonly title: string; readonly past: ReadonlySet<string> };

const EMBED_ROUNDS = 3;

function mayRead(reader: Reader, area: string): boolean {
  return can(reader.actor, 'read', { kind: 'area', area }, reader.at);
}

async function sourcesOf(
  db: Executor,
  reader: Reader,
  ids: readonly string[],
): Promise<ReadonlyMap<string, EmbedSource>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({
      id: pages.id,
      title: pages.title,
      jdArea: pages.jdArea,
      status: pages.status,
      bodyMd: pages.bodyMd,
    })
    .from(pages)
    .where(inArray(pages.id, [...ids]));
  const found = new Map<string, EmbedSource>(ids.map((id) => [id, { kind: 'missing' }]));
  for (const row of rows) {
    if (row.status === 'retired') continue;
    found.set(
      row.id,
      mayRead(reader, row.jdArea)
        ? { kind: 'page', title: row.title, bodyMd: row.bodyMd }
        : { kind: 'denied' },
    );
  }
  return found;
}

async function gatherEmbeds(
  db: Executor,
  reader: Reader,
  bodyMd: string,
): Promise<ReadonlyMap<string, EmbedSource>> {
  const gathered = new Map<string, EmbedSource>();
  let bodies = [bodyMd];
  for (let round = 0; round < EMBED_ROUNDS && bodies.length > 0; round += 1) {
    const wanted = bodies
      .flatMap((body) => pageRefs(body).embeds.map((embed) => embed.id))
      .filter((id) => !gathered.has(id));
    const fresh = await sourcesOf(db, reader, [...new Set(wanted)]);
    for (const [id, source] of fresh) gathered.set(id, source);
    bodies = [...fresh.values()].flatMap((source) =>
      source.kind === 'page' ? [source.bodyMd] : [],
    );
  }
  return gathered;
}

async function titlesOf(
  db: Executor,
  reader: Reader,
  ids: readonly string[],
): Promise<ReadonlyMap<string, Titles>> {
  if (ids.length === 0) return new Map();
  const current = await db
    .select({ id: pages.id, title: pages.title, jdArea: pages.jdArea })
    .from(pages)
    .where(inArray(pages.id, [...ids]));
  const readable = current.filter((row) => mayRead(reader, row.jdArea));
  if (readable.length === 0) return new Map();
  const earlier = await db
    .selectDistinct({ id: pageVersions.pageId, title: pageVersions.title })
    .from(pageVersions)
    .innerJoin(pages, eq(pages.id, pageVersions.pageId))
    .where(
      and(
        inArray(
          pageVersions.pageId,
          readable.map((row) => row.id),
        ),
      ),
    );
  return new Map(
    readable.map((row) => [
      row.id,
      {
        title: row.title,
        past: new Set(earlier.filter((old) => old.id === row.id).map((old) => old.title)),
      },
    ]),
  );
}

export function embedSources(
  db: Executor,
  actor: Principal,
  bodyMd: string,
  at: Date,
): Promise<ReadonlyMap<string, EmbedSource>> {
  return gatherEmbeds(db, { actor, at }, bodyMd);
}

export async function renderPage(
  db: Executor,
  actor: Principal,
  page: Page,
  at: Date,
): Promise<Rendered> {
  const reader = { actor, at };
  const embeds = await gatherEmbeds(db, reader, page.bodyMd);
  const bodies = [
    page.bodyMd,
    ...[...embeds.values()].flatMap((source) => (source.kind === 'page' ? [source.bodyMd] : [])),
  ];
  const linked = [...new Set(bodies.flatMap((body) => pageRefs(body).links))];
  const titles = await titlesOf(db, reader, linked);
  const targets = bodies.flatMap((body) => wikiRefs(body).map((ref) => ref.target));
  const wiki = await resolverFor(db, actor, { targets, area: page.jdArea }, at);
  const hooks: RenderHooks = {
    wiki,
    embed: (id) => embeds.get(id) ?? { kind: 'missing' },
    linkTitle: (id, shown) => {
      const known = titles.get(id);
      if (known === undefined || shown === known.title) return null;
      return known.past.has(shown) ? known.title : null;
    },
  };
  return renderMarkdown(page.bodyMd, hooks);
}
