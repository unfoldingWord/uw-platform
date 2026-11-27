import { z } from 'zod';
import type { BrowserBinding, MarkdownQuickAction } from '../../env.ts';
import { failureOf, type HttpFailure } from './http.ts';

export type Rendered =
  | { readonly ok: true; readonly markdown: string }
  | { readonly ok: false; readonly failure: HttpFailure };

const PAGE_WAIT_MS = 15_000;
const MARKDOWN_MOST = 400_000;

const renderedSchema = z.object({ success: z.literal(true), result: z.string() });

function escaped(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

function sameOriginPattern(url: string): string {
  return `^${escaped(new URL(url).origin)}/`;
}

function actionOf(url: string): MarkdownQuickAction {
  return {
    url,
    allowRequestPattern: [sameOriginPattern(url)],
    rejectResourceTypes: ['image', 'media', 'font'],
    gotoOptions: { waitUntil: 'networkidle2', timeout: PAGE_WAIT_MS },
    cacheTTL: 0,
  };
}

async function markdownOf(response: Response): Promise<Rendered> {
  const body = (await response.text()).slice(0, MARKDOWN_MOST);
  if (!(response.headers.get('content-type') ?? '').includes('json')) {
    return { ok: true, markdown: body };
  }
  const parsed = renderedSchema.safeParse(JSON.parse(body));
  return parsed.success
    ? { ok: true, markdown: parsed.data.result }
    : { ok: false, failure: 'unavailable' };
}

export async function renderMarkdown(browser: BrowserBinding, url: string): Promise<Rendered> {
  try {
    const response = await browser.quickAction('markdown', actionOf(url));
    if (!response.ok) return { ok: false, failure: failureOf(response.status) };
    return await markdownOf(response);
  } catch {
    return { ok: false, failure: 'unavailable' };
  }
}
