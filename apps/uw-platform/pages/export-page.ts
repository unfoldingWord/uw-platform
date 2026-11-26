import { formatDate } from '@uw/core/dates';
import type { Page, PageExportMode } from '@uw/contracts';
import type { Principal } from '@uw/core/principal';
import type { Executor } from '@uw/db/client';
import { exportMarkdown } from '../markdown/export.ts';
import { pageSourceHash } from '../pdf/page-source.ts';
import { embedSources } from './render-page.ts';
import { markableChanges } from './review-sets.ts';

type Reader = { readonly db: Executor; readonly actor: Principal; readonly at: Date };

export async function pageExportText(
  reader: Reader,
  page: Page,
  mode: PageExportMode,
): Promise<string> {
  const { db, actor, at } = reader;
  const sources = await embedSources(db, actor, page.bodyMd, at);
  const hash = await pageSourceHash(reader, page);
  const marked = mode === 'marked' ? await markableChanges(db, actor, page, at) : null;
  const stamp = { exported: formatDate(at), sha256: hash.sourceSha256, withheld: hash.withheld };
  return exportMarkdown(page, (id) => sources.get(id) ?? { kind: 'missing' }, {
    mode,
    stamp,
    marks: marked?.changes ?? [],
    leftOut: marked?.leftOut ?? 0,
  });
}
