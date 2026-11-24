import type { Context } from 'hono';
import type { Page } from '@uw/contracts';
import type { AppEnv } from '../../deps.ts';
import type { Printed } from '../../pdf/print-document.ts';
import { pageVersionHash } from '../../pdf/provenance.ts';
import { wantsPdf } from './frame.tsx';

function pageReference(page: Page): string {
  return `${page.jdArea}/${page.slug}@v${String(page.version)}`;
}

async function pagePrinted(page: Page): Promise<Printed> {
  const snapshot = { ...page, pageId: page.id };
  const sha256 = await pageVersionHash(snapshot);
  return { reference: pageReference(page), filters: [], hashInput: { kind: 'hash', sha256 } };
}

export async function printedPage(
  c: Context<AppEnv>,
  page: Page,
): Promise<{ readonly printed?: Printed }> {
  return wantsPdf(c) ? { printed: await pagePrinted(page) } : {};
}
