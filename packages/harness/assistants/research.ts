import { verbIo, type AssistantResearchKind } from '@uw/contracts';
import { formatMoney } from '@uw/core/money';
import type { Caller } from '../caller.ts';
import { accepted, refused, type KernelOutcome, type Refused } from '../outcome.ts';
import type { FlightLeg, FlightOffer, ResearchFailure } from '../ports.ts';
import { renderUntrusted, untrusted } from '../untrusted.ts';
import {
  recordRendered,
  reserveResearch,
  type Reserved,
  type ResearchPorts,
} from './research-ledger.ts';
import { addressed, type TurnAddress } from './reminder-turn.ts';

export type SearchWebInput = TurnAddress & {
  readonly query: string;
  readonly count?: number | undefined;
};
export type ReadWebPageInput = TurnAddress & { readonly url: string };
export type FindFlightsInput = TurnAddress & {
  readonly origin: string;
  readonly destination: string;
  readonly departDate: string;
  readonly returnDate?: string | undefined;
  readonly passengers?: number | undefined;
  readonly cabin?: string | undefined;
};
export type WebSearched = { readonly results: readonly { url: string; details: string }[] };
export type WebPageRead = {
  readonly url: string;
  readonly rendered: boolean;
  readonly truncated: boolean;
  readonly content: string;
};
export type FlightsFound = {
  readonly offers: readonly {
    totalMinor: number;
    currency: string;
    expiresAt: string;
    stops: number;
    durationMinutes: number;
    details: string;
  }[];
};

const SEARCH_COUNT = 5;
const TITLE_MOST = 300;
const SNIPPET_MOST = 600;

async function asked<T>(work: () => Promise<T>): Promise<T | 'not_wired'> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof Error && error.name === 'PortNotWiredError') return 'not_wired';
    throw error;
  }
}

function trouble(outcome: ResearchFailure | 'not_wired'): Refused {
  if (outcome === 'not_wired') return refused('not_wired', { why: 'research_not_wired' });
  if (outcome === 'refused') return refused('not_permitted', { why: 'research_refused' });
  return refused('internal_error', { why: 'research_unavailable' });
}

function inputRefusal(): Refused {
  return refused('malformed_command', { why: 'research_input' });
}

async function reserve(
  ports: ResearchPorts,
  caller: Caller,
  input: TurnAddress,
  kind: AssistantResearchKind,
): Promise<Reserved | Refused> {
  return reserveResearch(ports, caller, { requestId: input.requestId, turnId: input.turnId }, kind);
}

function fenced(source: 'search_result' | 'web_page' | 'flight_offer', text: string): string {
  return renderUntrusted(untrusted({ source, itemId: null, text }));
}

export async function searchWeb(
  ports: ResearchPorts,
  caller: Caller,
  input: SearchWebInput,
): Promise<KernelOutcome<WebSearched>> {
  const parsed = verbIo.search_web.input.safeParse({ query: input.query, count: input.count });
  if (!parsed.success || !addressed(input)) return inputRefusal();
  const reserved = await reserve(ports, caller, input, 'web_search');
  if ('status' in reserved) return reserved;
  const query = { query: parsed.data.query, count: parsed.data.count ?? SEARCH_COUNT };
  const found = await asked(() => ports.research.search(query));
  if (found === 'not_wired' || found.outcome !== 'found') {
    return trouble(found === 'not_wired' ? found : found.outcome);
  }
  const results = found.results.slice(0, query.count).map((result) => ({
    url: result.url,
    details: fenced(
      'search_result',
      `Title: ${result.title.slice(0, TITLE_MOST)}\nAddress: ${result.url}\nSnippet: ${result.snippet.slice(0, SNIPPET_MOST)}`,
    ),
  }));
  return accepted({ results });
}

export async function readWebPage(
  ports: ResearchPorts,
  caller: Caller,
  input: ReadWebPageInput,
): Promise<KernelOutcome<WebPageRead>> {
  const parsed = verbIo.read_web_page.input.safeParse({ url: input.url });
  if (!parsed.success || !addressed(input)) return inputRefusal();
  const reserved = await reserve(ports, caller, input, 'page_read');
  if ('status' in reserved) return reserved;
  const request = { url: parsed.data.url, mayRender: reserved.mayRender };
  const read = await asked(() => ports.research.read(request));
  if (read === 'not_wired') return trouble(read);
  if (read.outcome === 'blocked') {
    return refused('not_permitted', { why: 'address_blocked', reason: read.why });
  }
  if (read.outcome === 'unreadable') return refused('page_not_found', { why: 'page_unreadable' });
  if (read.outcome !== 'read') return trouble(read.outcome);
  if (read.rendered) await recordRendered(ports, caller, reserved);
  return accepted({
    url: read.url,
    rendered: read.rendered,
    truncated: read.truncated,
    content: fenced('web_page', `Title: ${read.title.slice(0, TITLE_MOST)}\n\n${read.text}`),
  });
}

function legLine(leg: FlightLeg): string {
  const stops = leg.flights.length - 1;
  const hours = `${String(Math.floor(leg.durationMinutes / 60))}h${String(leg.durationMinutes % 60).padStart(2, '0')}`;
  return `${leg.from} ${leg.departAt} to ${leg.to} ${leg.arriveAt}, ${String(stops)} stop(s), ${hours}, flights ${leg.flights.join(' ')}`;
}

function offerOf(offer: FlightOffer): FlightsFound['offers'][number] {
  const total = formatMoney({ amountMinor: offer.totalMinor, currency: offer.currency });
  const lines = [
    `Airline: ${offer.airline.slice(0, TITLE_MOST)}`,
    `Total for all passengers: ${total} (${offer.currency})`,
    ...offer.legs.map(legLine),
  ];
  return {
    totalMinor: offer.totalMinor,
    currency: offer.currency,
    expiresAt: offer.expiresAt.toISOString(),
    stops: offer.legs.reduce((sum, leg) => sum + Math.max(0, leg.flights.length - 1), 0),
    durationMinutes: offer.legs.reduce((sum, leg) => sum + leg.durationMinutes, 0),
    details: fenced('flight_offer', lines.join('\n')),
  };
}

function flightQueryOf(input: FindFlightsInput) {
  const { origin, destination, departDate, returnDate, passengers, cabin } = input;
  const parsed = verbIo.find_flights.input.safeParse({
    origin,
    destination,
    departDate,
    returnDate,
    passengers,
    cabin,
  });
  if (!parsed.success || !addressed(input)) return null;
  const back = parsed.data.returnDate ?? null;
  if (back !== null && back < parsed.data.departDate) return null;
  if (parsed.data.origin === parsed.data.destination) return null;
  return {
    origin: parsed.data.origin,
    destination: parsed.data.destination,
    departDate: parsed.data.departDate,
    returnDate: back,
    passengers: parsed.data.passengers ?? 1,
    cabin: parsed.data.cabin ?? 'economy',
  };
}

export async function findFlights(
  ports: ResearchPorts,
  caller: Caller,
  input: FindFlightsInput,
): Promise<KernelOutcome<FlightsFound>> {
  const query = flightQueryOf(input);
  if (query === null) return inputRefusal();
  const reserved = await reserve(ports, caller, input, 'flight_search');
  if ('status' in reserved) return reserved;
  const found = await asked(() => ports.research.flights(query));
  if (found === 'not_wired' || found.outcome !== 'offered') {
    return trouble(found === 'not_wired' ? found : found.outcome);
  }
  const offers = [...found.offers].sort((a, b) => a.totalMinor - b.totalMinor).map(offerOf);
  return accepted({ offers });
}
