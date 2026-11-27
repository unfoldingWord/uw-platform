import type { FlightOffer, FlightQuery, WebResult } from '@uw/harness';
import type { BrowserBinding } from '../../../env.ts';
import { duffelOfferOf, routeKeyOf, type DuffelRoute } from './fake-duffel.ts';

type FakePage = {
  readonly title: string;
  readonly text: string;
  readonly needsRendering?: boolean;
  readonly contentType?: string;
  readonly navigatesTo?: string;
};
type FakeRequest = {
  readonly method: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly redirect: string | null;
  readonly body: unknown;
};
export type FakeResearch = {
  readonly fetch: typeof fetch;
  readonly browser: BrowserBinding & { rendered(): readonly string[] };
  readonly braveKey: string;
  readonly duffelToken: string;
  addResults(query: string, results: readonly WebResult[]): void;
  addPage(url: string, page: FakePage): void;
  addRedirect(from: string, to: string): void;
  addOffers(query: FlightQuery, offers: readonly FlightOffer[]): void;
  resolve(hostname: string, addresses: readonly string[]): void;
  failNext(host: string, status: number): void;
  requests(): readonly FakeRequest[];
  owns(url: string): boolean;
};

type State = {
  readonly results: Map<string, readonly WebResult[]>;
  readonly pages: Map<string, FakePage>;
  readonly redirects: Map<string, string>;
  readonly offers: Map<string, readonly FlightOffer[]>;
  readonly requested: Map<string, DuffelRoute>;
  readonly addresses: Map<string, readonly string[]>;
  readonly failures: Map<string, number>;
  readonly requests: FakeRequest[];
  readonly rendered: string[];
};

const PUBLIC_ADDRESS = '93.184.215.14';
const API_HOSTS: ReadonlySet<string> = new Set([
  'api.search.brave.com',
  'cloudflare-dns.com',
  'api.duffel.com',
]);
const braveKey = 'BSAfakebravekey0001';
const duffelToken = 'duffel_test_fakeaccesstoken0001';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function headersOf(init: RequestInit | undefined): Record<string, string> {
  return Object.fromEntries(new Headers(init?.headers).entries());
}

function htmlOf(page: FakePage): string {
  if (page.needsRendering === true) {
    return `<!doctype html><head><title>${page.title}</title></head><body><div id="app"></div><script src="/app.js"></script></body>`;
  }
  return `<!doctype html><head><title>${page.title}</title></head><body><section><p>${page.text}</p></section></body>`;
}

function brave(state: State, url: URL, headers: Record<string, string>): Response {
  if (headers['x-subscription-token'] !== braveKey) return json({ error: 'unauthorized' }, 401);
  const found = state.results.get(url.searchParams.get('q') ?? '') ?? [];
  const count = Number(url.searchParams.get('count') ?? '20');
  const results = found.slice(0, count).map((result) => ({
    type: 'search_result',
    title: result.title,
    url: result.url,
    description: `<strong>${result.snippet}</strong>`,
    language: 'en',
  }));
  return json({
    type: 'search',
    query: { original: url.searchParams.get('q') },
    web: { type: 'search', results },
  });
}

function dns(state: State, url: URL): Response {
  const name = url.searchParams.get('name') ?? '';
  const type = url.searchParams.get('type') === 'AAAA' ? 28 : 1;
  const known = state.addresses.get(name) ?? [PUBLIC_ADDRESS];
  const fitting = known.filter((address) => address.includes(':') === (type === 28));
  const Answer = fitting.map((data) => ({ name, type, TTL: 300, data }));
  return json({ Status: 0, TC: false, RD: true, RA: true, AD: false, CD: false, Answer });
}

function web(state: State, url: URL): Response {
  const target = state.redirects.get(url.href);
  if (target !== undefined)
    return new Response(null, { status: 302, headers: { location: target } });
  const page = state.pages.get(url.href);
  if (page === undefined) return new Response('Not found', { status: 404 });
  const type = page.contentType ?? 'text/html; charset=utf-8';
  return new Response(type.startsWith('text/html') ? htmlOf(page) : page.text, {
    status: 200,
    headers: { 'content-type': type },
  });
}

function duffelRefusal(init: RequestInit | undefined): Response | null {
  const headers = headersOf(init);
  if (headers['authorization'] !== `Bearer ${duffelToken}`) return json({ errors: [] }, 401);
  if (headers['duffel-version'] !== 'v2') {
    return json({ errors: [{ code: 'unsupported_version' }] }, 400);
  }
  return null;
}

function offerRequest(state: State, init: RequestInit | undefined): Response {
  const body = JSON.parse(String(init?.body)) as { data: DuffelRoute };
  const id = `orq_${String(state.requested.size + 1).padStart(6, '0')}`;
  state.requested.set(id, body.data);
  return json({ data: { id, live_mode: false, slices: body.data.slices, offers: [] } }, 201);
}

function offerList(state: State, url: URL): Response {
  const route = state.requested.get(url.searchParams.get('offer_request_id') ?? '');
  const offers = route === undefined ? [] : (state.offers.get(routeKeyOf(route)) ?? []);
  const limit = Number(url.searchParams.get('limit') ?? '50');
  const sorted = [...offers].sort((a, b) => a.totalMinor - b.totalMinor).slice(0, limit);
  return json({ data: sorted.map(duffelOfferOf), meta: { limit, after: null, before: null } });
}

function duffel(state: State, url: URL, init: RequestInit | undefined): Response {
  const refusal = duffelRefusal(init);
  if (refusal !== null) return refusal;
  const method = init?.method ?? 'GET';
  if (url.pathname === '/air/offer_requests' && method === 'POST') return offerRequest(state, init);
  if (url.pathname === '/air/offers' && method === 'GET') return offerList(state, url);
  return json({ errors: [{ code: 'not_found' }] }, 404);
}

function routed(state: State, url: URL, init: RequestInit | undefined): Response {
  const failure = state.failures.get(url.host);
  if (failure !== undefined) {
    state.failures.delete(url.host);
    return json({ error: 'scripted failure' }, failure);
  }
  if (url.host === 'api.search.brave.com') return brave(state, url, headersOf(init));
  if (url.host === 'cloudflare-dns.com') return dns(state, url);
  if (url.host === 'api.duffel.com') return duffel(state, url, init);
  return web(state, url);
}

function prefixOf(pattern: string): string | null {
  if (!pattern.startsWith('^')) return null;
  const literal = pattern.slice(1).replace(/\\(.)/g, '$1');
  return /[*+?()[\]{}|$]/.test(literal) ? null : literal;
}

function allowedBy(patterns: readonly string[] | undefined, url: string): boolean {
  if (patterns === undefined) return true;
  return patterns.some((pattern) => {
    const prefix = prefixOf(pattern);
    if (prefix === null)
      throw new RangeError(`the fake browser reads only prefix patterns: ${pattern}`);
    return url.startsWith(prefix);
  });
}

function landedOn(state: State, start: string, patterns: readonly string[] | undefined) {
  const page = state.pages.get(start);
  const next = page?.navigatesTo;
  if (next === undefined || !allowedBy(patterns, next)) return page;
  state.rendered.push(next);
  return state.pages.get(next) ?? { title: 'Elsewhere', text: `Loaded ${next}` };
}

function browserOf(state: State): FakeResearch['browser'] {
  return {
    quickAction: async (action, options) => {
      if (action !== 'markdown' || !('url' in options)) return new Response('no', { status: 400 });
      const patterns = 'allowRequestPattern' in options ? options.allowRequestPattern : undefined;
      if (!allowedBy(patterns, options.url)) return json({ success: false, errors: [] }, 422);
      state.rendered.push(options.url);
      const page = landedOn(state, options.url, patterns);
      if (page === undefined) return json({ success: false, errors: [] }, 422);
      return json({ success: true, result: `# ${page.title}\n\n${page.text}` });
    },
    rendered: () => [...state.rendered],
  };
}

function stateOf(): State {
  return {
    results: new Map(),
    pages: new Map(),
    redirects: new Map(),
    offers: new Map(),
    requested: new Map(),
    addresses: new Map(),
    failures: new Map(),
    requests: [],
    rendered: [],
  };
}

export function fakeResearch(): FakeResearch {
  const state = stateOf();
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : null;
    const method = init?.method ?? 'GET';
    const redirect = init?.redirect ?? null;
    state.requests.push({ method, url: url.href, headers: headersOf(init), redirect, body });
    return routed(state, url, init);
  };
  return {
    fetch: fetcher,
    browser: browserOf(state),
    braveKey,
    duffelToken,
    addResults: (query, results) => state.results.set(query, results),
    addPage: (url, page) => state.pages.set(url, page),
    addRedirect: (from, to) => state.redirects.set(from, to),
    addOffers: (query, offers) => state.offers.set(routeKeyOf(query), offers),
    resolve: (hostname, addresses) => state.addresses.set(hostname, addresses),
    failNext: (host, status) => state.failures.set(host, status),
    requests: () => [...state.requests],
    owns: (url) => ownedBy(state, url),
  };
}

function ownedBy(state: State, url: string): boolean {
  if (!URL.canParse(url)) return false;
  const host = new URL(url).host;
  if (API_HOSTS.has(host)) return true;
  return [...state.pages.keys(), ...state.redirects.keys()].some(
    (known) => new URL(known).host === host,
  );
}
