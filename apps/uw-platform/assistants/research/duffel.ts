import { FLIGHT_OFFERS_MOST } from '@uw/contracts';
import { parseMoney } from '@uw/core/money';
import type { FlightLeg, FlightOffer, FlightOffers, FlightQuery } from '@uw/harness';
import { z } from 'zod';
import { jsonCall, type Fetcher, type HttpAnswer } from './http.ts';

export type DuffelDeps = { readonly accessToken: string; readonly fetcher: Fetcher };

export const DUFFEL_API = 'https://api.duffel.com';
const DUFFEL_VERSION = 'v2';

const REQUEST_TIMEOUT_MS = 25_000;
const LIST_TIMEOUT_MS = 8_000;
const SUPPLIER_TIMEOUT_MS = '15000';
const MAX_CONNECTIONS = 2;
const LOCAL_MINUTE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const LOCAL_SECONDS = /^:\d{2}$/;
const DURATION_PARTS: readonly (readonly [RegExp, number])[] = [
  [/(\d{1,4})D/, 1440],
  [/(\d{1,4})H/, 60],
  [/(\d{1,4})M/, 1],
];

function localTime(text: string): boolean {
  const seconds = text.slice(16);
  return LOCAL_MINUTE.test(text.slice(0, 16)) && (seconds === '' || LOCAL_SECONDS.test(seconds));
}

const place = z.object({ iata_code: z.string() });
const segmentSchema = z.object({
  departing_at: z.string().refine(localTime),
  arriving_at: z.string().refine(localTime),
  marketing_carrier: z.object({ iata_code: z.string() }),
  marketing_carrier_flight_number: z.string(),
});
const offerSchema = z.object({
  total_amount: z.string(),
  total_currency: z.string(),
  expires_at: z.iso.datetime({ offset: true }),
  owner: z.object({ name: z.string() }),
  slices: z.array(
    z.object({
      origin: place,
      destination: place,
      duration: z.string().nullable(),
      segments: z.array(segmentSchema).min(1),
    }),
  ),
});
const requestedSchema = z.object({ data: z.object({ id: z.string().regex(/^orq_\w+$/) }) });
const listedSchema = z.object({ data: z.array(z.unknown()) });

function headersOf(deps: DuffelDeps): Record<string, string> {
  return {
    authorization: `Bearer ${deps.accessToken}`,
    'duffel-version': DUFFEL_VERSION,
    accept: 'application/json',
    'content-type': 'application/json',
  };
}

function bodyOf(query: FlightQuery): string {
  const out = {
    origin: query.origin,
    destination: query.destination,
    departure_date: query.departDate,
  };
  const back =
    query.returnDate === null
      ? []
      : [
          {
            origin: query.destination,
            destination: query.origin,
            departure_date: query.returnDate,
          },
        ];
  return JSON.stringify({
    data: {
      slices: [out, ...back],
      passengers: Array.from({ length: query.passengers }, () => ({ type: 'adult' })),
      cabin_class: query.cabin,
      max_connections: MAX_CONNECTIONS,
    },
  });
}

function requestOffers(deps: DuffelDeps, query: FlightQuery): Promise<HttpAnswer> {
  const params = new URLSearchParams({
    return_offers: 'false',
    supplier_timeout: SUPPLIER_TIMEOUT_MS,
  });
  const url = `${DUFFEL_API}/air/offer_requests?${params.toString()}`;
  const init = { method: 'POST', headers: headersOf(deps), body: bodyOf(query) };
  return jsonCall(deps.fetcher, url, init, REQUEST_TIMEOUT_MS);
}

function listOffers(deps: DuffelDeps, requestId: string): Promise<HttpAnswer> {
  const params = new URLSearchParams({
    offer_request_id: requestId,
    sort: 'total_amount',
    limit: String(FLIGHT_OFFERS_MOST),
  });
  const init = { method: 'GET', headers: headersOf(deps) };
  return jsonCall(
    deps.fetcher,
    `${DUFFEL_API}/air/offers?${params.toString()}`,
    init,
    LIST_TIMEOUT_MS,
  );
}

function minutesOf(duration: string | null): number {
  if (duration === null || !duration.startsWith('P')) return 0;
  return DURATION_PARTS.reduce((sum, [pattern, scale]) => {
    const match = pattern.exec(duration);
    return sum + (match === null ? 0 : Number(match[1]) * scale);
  }, 0);
}

function legOf(slice: z.infer<typeof offerSchema>['slices'][number]): FlightLeg {
  const first = slice.segments[0];
  const last = slice.segments.at(-1);
  return {
    from: slice.origin.iata_code,
    to: slice.destination.iata_code,
    departAt: first?.departing_at ?? '',
    arriveAt: last?.arriving_at ?? '',
    durationMinutes: minutesOf(slice.duration),
    flights: slice.segments.map(
      (segment) =>
        `${segment.marketing_carrier.iata_code}${segment.marketing_carrier_flight_number}`,
    ),
  };
}

function offerOf(raw: unknown): FlightOffer | null {
  const parsed = offerSchema.safeParse(raw);
  if (!parsed.success) return null;
  const offer = parsed.data;
  const money = parseMoney(offer.total_amount, offer.total_currency);
  if (money === null) return null;
  return {
    airline: offer.owner.name,
    totalMinor: money.amountMinor,
    currency: money.currency,
    expiresAt: new Date(offer.expires_at),
    legs: offer.slices.map(legOf),
  };
}

export async function duffelFlights(deps: DuffelDeps, query: FlightQuery): Promise<FlightOffers> {
  const requested = await requestOffers(deps, query);
  if (!requested.ok) return { outcome: requested.failure };
  const created = requestedSchema.safeParse(requested.body);
  if (!created.success) return { outcome: 'unavailable' };
  const listed = await listOffers(deps, created.data.data.id);
  if (!listed.ok) return { outcome: listed.failure };
  const page = listedSchema.safeParse(listed.body);
  if (!page.success) return { outcome: 'unavailable' };
  const offers = page.data.data
    .map(offerOf)
    .filter((offer): offer is FlightOffer => offer !== null)
    .sort((a, b) => a.totalMinor - b.totalMinor)
    .slice(0, FLIGHT_OFFERS_MOST);
  return { outcome: 'offered', offers };
}
