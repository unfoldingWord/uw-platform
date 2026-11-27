import type { WebQuery, WebResult, WebResults } from '@uw/harness';
import { z } from 'zod';
import { jsonCall, type Fetcher } from './http.ts';

export type BraveDeps = { readonly apiKey: string; readonly fetcher: Fetcher };

export const BRAVE_SEARCH_URL = 'https://api.search.brave.com/res/v1/web/search';

const TIMEOUT_MS = 6_000;
const TAG = /<[^>]*>/g;

const braveAnswerSchema = z.object({
  web: z
    .object({
      results: z
        .array(
          z.object({
            title: z.string(),
            url: z.string(),
            description: z.string().optional(),
          }),
        )
        .optional(),
    })
    .optional(),
});

function plain(text: string): string {
  return text
    .replace(TAG, '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}

function webAddress(url: string): boolean {
  if (!URL.canParse(url)) return false;
  const protocol = new URL(url).protocol;
  return protocol === 'https:' || protocol === 'http:';
}

export async function braveSearch(deps: BraveDeps, query: WebQuery): Promise<WebResults> {
  const url = `${BRAVE_SEARCH_URL}?${new URLSearchParams({
    q: query.query,
    count: String(query.count),
    safesearch: 'moderate',
    text_decorations: 'false',
  }).toString()}`;
  const init = {
    method: 'GET',
    headers: { accept: 'application/json', 'x-subscription-token': deps.apiKey },
  };
  const answer = await jsonCall(deps.fetcher, url, init, TIMEOUT_MS);
  if (!answer.ok) return { outcome: answer.failure };
  const parsed = braveAnswerSchema.safeParse(answer.body);
  if (!parsed.success) return { outcome: 'unavailable' };
  const results: WebResult[] = (parsed.data.web?.results ?? [])
    .filter((result) => webAddress(result.url))
    .slice(0, query.count)
    .map((result) => ({
      title: plain(result.title),
      url: result.url,
      snippet: plain(result.description ?? ''),
    }));
  return { outcome: 'found', results };
}
