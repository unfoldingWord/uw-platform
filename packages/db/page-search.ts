import { sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

export const SEARCH_LANGUAGE = 'english';
const INDEXED_BODY = 500_000;

type Searched = {
  readonly title: AnyPgColumn;
  readonly frontmatter: AnyPgColumn;
  readonly bodyMd: AnyPgColumn;
};

const language = sql.raw(`'${SEARCH_LANGUAGE}'`);
const indexedBody = sql.raw(String(INDEXED_BODY));

export function titleDocument(title: AnyPgColumn): SQL {
  return sql`to_tsvector(${language}, ${title})`;
}

export function searchDocument(page: Searched): SQL {
  const filed = sql`coalesce(${page.frontmatter}->>'jd_id', '') || ' ' || coalesce(${page.frontmatter}->>'overview', '') || ' ' || coalesce(${page.frontmatter}->'tags', '[]'::jsonb)::text || ' ' || coalesce(${page.frontmatter}->'aliases', '[]'::jsonb)::text`;
  return sql`(setweight(${titleDocument(page.title)}, 'A') || setweight(to_tsvector(${language}, ${filed}), 'B') || setweight(to_tsvector(${language}, left(${page.bodyMd}, ${indexedBody})), 'D'))`;
}

export function searchTerms(text: string): SQL {
  return sql`websearch_to_tsquery(${language}, ${text})`;
}
