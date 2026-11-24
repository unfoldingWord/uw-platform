import type { Page } from '@uw/contracts';
import type { Principal } from '@uw/core/principal';
import type { Executor } from '@uw/db/client';
import { shownVersion } from '../pages/history.ts';
import type { Printed, SourceHash } from './print-document.ts';
import { pageVersionHash } from './provenance.ts';

type Reader = { readonly db: Executor; readonly actor: Principal; readonly at: Date };

export function pageReference(page: Page): string {
  return `${page.jdArea}/${page.slug}@v${String(page.version)}`;
}

export async function pageSourceHash(reader: Reader, page: Page): Promise<SourceHash> {
  const key = { pageId: page.id, version: page.version };
  const shown = await shownVersion(reader.db, reader.actor, key, reader.at);
  const source = shown?.snapshot.page ?? page;
  return {
    sourceSha256: await pageVersionHash({ ...source, pageId: page.id }),
    withheld: shown?.withheld ?? true,
  };
}

export async function pagePrinted(reader: Reader, page: Page): Promise<Printed> {
  const hashInput = { kind: 'hash' as const, ...(await pageSourceHash(reader, page)) };
  return { reference: pageReference(page), filters: [], hashInput };
}
