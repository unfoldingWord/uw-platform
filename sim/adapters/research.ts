import {
  FLIGHT_OFFERS_MOST,
  WEB_PAGE_TEXT_MOST,
  WEB_REDIRECTS_MOST,
  type WebAddressRefusal,
} from '@uw/contracts';
import {
  webAddressRefusal,
  type FlightOffer,
  type FlightOffers,
  type FlightQuery,
  type PageRequest,
  type PageText,
  type Research,
  type ResearchFailure,
  type WebResult,
  type WebResults,
} from '@uw/harness';

type SimPage = {
  readonly title: string;
  readonly text: string;
  readonly needsRendering?: boolean;
};

type SimResearchCall =
  | { readonly method: 'search'; readonly query: string }
  | { readonly method: 'read'; readonly url: string; readonly rendered: boolean }
  | { readonly method: 'flights'; readonly route: string };

export type SimResearch = Research & {
  addResults(query: string, results: readonly WebResult[]): void;
  addPage(url: string, page: SimPage): void;
  addRedirect(from: string, to: string): void;
  addOffers(query: FlightQuery, offers: readonly FlightOffer[]): void;
  failNextWith(outcome: ResearchFailure): void;
  calls(): readonly SimResearchCall[];
};

type Followed = { readonly url: string } | { readonly blocked: WebAddressRefusal };

type SimResearchState = {
  readonly results: Map<string, readonly WebResult[]>;
  readonly pages: Map<string, SimPage>;
  readonly redirects: Map<string, string>;
  readonly offers: Map<string, readonly FlightOffer[]>;
  readonly calls: SimResearchCall[];
  failure: ResearchFailure | null;
};

function routeOf(query: FlightQuery): string {
  const back = query.returnDate ?? 'one-way';
  return `${query.origin}>${query.destination}@${query.departDate}/${back}/${query.cabin}`;
}

function guard(url: string): WebAddressRefusal | null {
  if (!URL.canParse(url)) return 'not_web';
  return webAddressRefusal(new URL(url));
}

function follow(state: SimResearchState, start: string): Followed {
  let url = start;
  for (let hop = 0; ; hop += 1) {
    const refusal = guard(url);
    if (refusal !== null) return { blocked: refusal };
    const next = state.redirects.get(url);
    if (next === undefined) return { url };
    if (hop >= WEB_REDIRECTS_MOST) return { blocked: 'too_many_redirects' };
    url = next;
  }
}

function taken(state: SimResearchState): ResearchFailure | null {
  const failure = state.failure;
  state.failure = null;
  return failure;
}

function readIn(state: SimResearchState, request: PageRequest): PageText {
  const followed = follow(state, request.url);
  if ('blocked' in followed) return { outcome: 'blocked', why: followed.blocked };
  const failure = taken(state);
  if (failure !== null) return { outcome: failure };
  const page = state.pages.get(followed.url);
  const rendered = page?.needsRendering === true;
  if (page === undefined || (rendered && !request.mayRender)) return { outcome: 'unreadable' };
  state.calls.push({ method: 'read', url: followed.url, rendered });
  return {
    outcome: 'read',
    url: followed.url,
    title: page.title,
    text: page.text.slice(0, WEB_PAGE_TEXT_MOST),
    truncated: page.text.length > WEB_PAGE_TEXT_MOST,
    rendered,
  };
}

function searchIn(state: SimResearchState, query: string, count: number): WebResults {
  state.calls.push({ method: 'search', query });
  const failure = taken(state);
  if (failure !== null) return { outcome: failure };
  return { outcome: 'found', results: (state.results.get(query) ?? []).slice(0, count) };
}

function flightsIn(state: SimResearchState, query: FlightQuery): FlightOffers {
  state.calls.push({ method: 'flights', route: routeOf(query) });
  const failure = taken(state);
  if (failure !== null) return { outcome: failure };
  const offers = [...(state.offers.get(routeOf(query)) ?? [])]
    .sort((a, b) => a.totalMinor - b.totalMinor)
    .slice(0, FLIGHT_OFFERS_MOST);
  return { outcome: 'offered', offers };
}

export function createSimResearch(): SimResearch {
  const state: SimResearchState = {
    results: new Map(),
    pages: new Map(),
    redirects: new Map(),
    offers: new Map(),
    calls: [],
    failure: null,
  };
  return {
    search: async (query) => searchIn(state, query.query, query.count),
    read: async (request) => readIn(state, request),
    flights: async (query) => flightsIn(state, query),
    addResults: (query, results) => state.results.set(query, results),
    addPage: (url, page) => state.pages.set(url, page),
    addRedirect: (from, to) => state.redirects.set(from, to),
    addOffers: (query, offers) => state.offers.set(routeOf(query), offers),
    failNextWith: (outcome) => {
      state.failure = outcome;
    },
    calls: () => [...state.calls],
  };
}
