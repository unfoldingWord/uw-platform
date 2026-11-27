import { WEB_PAGE_TEXT_MOST } from '@uw/contracts';
import type { PageRequest, PageText } from '@uw/harness';
import type { BrowserBinding } from '../../env.ts';
import { renderMarkdown } from './browser-rendering.ts';
import { pageWords, type PageWords } from './html-text.ts';
import type { Fetcher } from './http.ts';
import { boundedText, guardedFetch } from './web-fetch.ts';

export type PageReadDeps = { readonly fetcher: Fetcher; readonly browser: BrowserBinding | null };

const THIN_TEXT = 200;
const HTML_TYPES = ['text/html', 'application/xhtml+xml'];

function wordsOf(contentType: string, body: string): PageWords | null {
  const type = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
  if (HTML_TYPES.includes(type)) return pageWords(body);
  if (type === 'text/plain') return { title: '', text: body.trim(), scripted: false };
  return null;
}

function readOf(url: string, title: string, text: string, rendered: boolean): PageText {
  return {
    outcome: 'read',
    url,
    title,
    text: text.slice(0, WEB_PAGE_TEXT_MOST),
    truncated: text.length > WEB_PAGE_TEXT_MOST,
    rendered,
  };
}

async function renderedRead(
  deps: PageReadDeps,
  request: PageRequest,
  url: string,
  words: PageWords,
): Promise<PageText> {
  if (!request.mayRender || deps.browser === null) return { outcome: 'unreadable' };
  const rendered = await renderMarkdown(deps.browser, url);
  if (!rendered.ok) return { outcome: rendered.failure };
  const text = rendered.markdown.trim();
  return text === '' ? { outcome: 'unreadable' } : readOf(url, words.title, text, true);
}

export async function readPage(deps: PageReadDeps, request: PageRequest): Promise<PageText> {
  const fetched = await guardedFetch(deps.fetcher, request.url);
  if (fetched.outcome !== 'fetched') return fetched;
  const { response, url } = fetched;
  if (!response.ok) {
    await response.body?.cancel();
    return { outcome: response.status >= 500 ? 'unavailable' : 'unreadable' };
  }
  const contentType = response.headers.get('content-type') ?? '';
  const words = wordsOf(contentType, await boundedText(response));
  if (words === null) return { outcome: 'unreadable' };
  if (words.text.length < THIN_TEXT && words.scripted) {
    return renderedRead(deps, request, url, words);
  }
  return words.text === ''
    ? { outcome: 'unreadable' }
    : readOf(url, words.title, words.text, false);
}
