import { formatDate } from '@uw/core/dates';
import type { Page, PageExportMode, RenderChannel } from '@uw/contracts';
import type { Principal } from '@uw/core/principal';
import type { Executor } from '@uw/db/client';
import { exportMarkdown } from '../markdown/export.ts';
import { fileIds } from '../markdown/file-video.ts';
import { withoutFiles } from '../markdown/withheld-files.ts';
import { filesWithheldIn } from '../stories/media.ts';
import { pageSourceHash } from '../pdf/page-source.ts';
import { recordStoryUses } from '../stories/uses.ts';
import { embedSources, embeddedPages } from './render-page.ts';
import { markableChanges } from './review-sets.ts';

type Reader = { readonly db: Executor; readonly actor: Principal; readonly at: Date };

export async function pageExportText(
  reader: Reader,
  page: Page,
  mode: PageExportMode,
  channel: RenderChannel = 'platform',
): Promise<string> {
  const { db, actor, at } = reader;
  const sources = await embedSources(db, actor, page.bodyMd, at, channel);
  const hash = await pageSourceHash(reader, page);
  const marked = mode === 'marked' ? await markableChanges(db, actor, page, at) : null;
  const stamp = { exported: formatDate(at), sha256: hash.sourceSha256, withheld: hash.withheld };
  const drawn = exportMarkdown(page, (id) => sources.get(id) ?? { kind: 'missing' }, {
    mode,
    stamp,
    marks: marked?.changes ?? [],
    leftOut: marked?.leftOut ?? 0,
  });
  const text = withoutFiles(drawn, await filesWithheldIn(db, fileIds(drawn), channel, at));
  const used = { channel, kind: 'markdown_export', reference: page.id } as const;
  const pageIds = [page.id, ...embeddedPages(sources)];
  await recordStoryUses(db, { pageIds, usedBy: actor.identity, at, ...used });
  return text;
}
