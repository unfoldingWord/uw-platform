import type { Context } from 'hono';
import { formatDate } from '@uw/core/dates';
import type { Principal } from '@uw/core/principal';
import type { AppEnv } from '../deps.ts';
import { refuse } from '../http/outcomes.ts';
import { bucketFiles } from '../pages/file-store.ts';
import { bufferOf } from '../pages/files.ts';
import { printJob, type Printed } from './print-document.ts';
import { fileImages, noImages } from './print-images.ts';
import type { ImageOf } from './print-html.ts';
import { exporterOf, sha256Hex, type Provenance } from './provenance.ts';
import { browserPdf } from './renderer.ts';

const FORMAT = 'format';
const LONGEST_NAME = 80;
const UNNAMED = 'export';

function originOf(c: Context<AppEnv>): string {
  return c.env.APP_ORIGIN ?? new URL(c.req.url).origin;
}

function sourceOf(c: Context<AppEnv>): string {
  const url = new URL(c.req.url);
  url.searchParams.delete(FORMAT);
  return `${originOf(c)}${url.pathname}${url.search}`;
}

function pdfFileName(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, LONGEST_NAME)
    .replace(/-+$/, '');
  return `${slug === '' ? UNNAMED : slug}.pdf`;
}

function hashOf(printed: Printed): Promise<string> {
  const input = printed.hashInput;
  return input.kind === 'hash' ? Promise.resolve(input.sha256) : sha256Hex(input.text);
}

export function screenPrinted(c: Context<AppEnv>, html: string): Printed {
  const params = new URL(c.req.url).searchParams;
  const filters = [...params]
    .filter(([key]) => key !== FORMAT)
    .map(([key, value]) => `${key}=${value}`)
    .sort();
  return { reference: c.req.path, filters, hashInput: { kind: 'text', text: html } };
}

function imagesOf(c: Context<AppEnv>, actor: Principal): ImageOf {
  const database = c.get('database');
  if (database === null || c.env.FILES === undefined) return noImages;
  const reader = { actor, at: c.get('now') };
  return fileImages(database.db, bucketFiles(c.env.FILES), reader, originOf(c));
}

async function provenanceOf(
  c: Context<AppEnv>,
  actor: Principal,
  printed: Printed,
): Promise<Provenance> {
  return {
    source: sourceOf(c),
    reference: printed.reference,
    filters: printed.filters,
    exportedBy: exporterOf(actor),
    exportedOn: formatDate(c.get('now')),
    sha256: await hashOf(printed),
  };
}

export async function pdfOfScreen(
  c: Context<AppEnv>,
  title: string,
  bodyHtml: string,
  printed: Printed,
): Promise<Response> {
  const actor = c.get('principal');
  if (actor === null) return refuse(c, 'unauthenticated');
  if (c.env.BROWSER === undefined) return refuse(c, 'not_wired');
  const provenance = await provenanceOf(c, actor, printed);
  const image = imagesOf(c, actor);
  const job = await printJob({ title, bodyHtml, provenance, origin: originOf(c), image });
  const pdf = await browserPdf(c.env.BROWSER).render(job);
  if (pdf === null) return refuse(c, 'pdf_render_failed');
  c.set('outcome', 'accepted');
  return c.body(bufferOf(pdf), 200, {
    'content-type': 'application/pdf',
    'content-disposition': `attachment; filename="${pdfFileName(title)}"`,
    'cache-control': 'no-store',
    'x-uw-sha256': provenance.sha256,
  });
}
