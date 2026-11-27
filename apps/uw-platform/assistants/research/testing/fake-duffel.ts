import type { FlightLeg, FlightOffer, FlightQuery } from '@uw/harness';

export type DuffelRoute = {
  readonly slices: readonly {
    readonly origin: string;
    readonly destination: string;
    readonly departure_date: string;
  }[];
  readonly passengers: readonly { readonly type: string }[];
  readonly cabin_class: string;
};

function isQuery(route: FlightQuery | DuffelRoute): route is FlightQuery {
  return 'origin' in route;
}

function keyOf(origin: string, destination: string, out: string, back: string, cabin: string) {
  return `${origin}>${destination}@${out}/${back}/${cabin}`;
}

export function routeKeyOf(route: FlightQuery | DuffelRoute): string {
  if (isQuery(route)) {
    const back = route.returnDate ?? 'one-way';
    return keyOf(route.origin, route.destination, route.departDate, back, route.cabin);
  }
  const [out, back] = route.slices;
  if (out === undefined) return '';
  const backDate = back?.departure_date ?? 'one-way';
  return keyOf(out.origin, out.destination, out.departure_date, backDate, route.cabin_class);
}

function amountOf(totalMinor: number): string {
  return `${String(Math.floor(totalMinor / 100))}.${String(totalMinor % 100).padStart(2, '0')}`;
}

function durationOf(minutes: number): string {
  return `PT${String(Math.floor(minutes / 60))}H${String(minutes % 60)}M`;
}

function segmentsOf(leg: FlightLeg) {
  return leg.flights.map((flight, index) => ({
    id: `seg_${flight}`,
    departing_at: index === 0 ? leg.departAt : `${leg.departAt.slice(0, 10)}T12:00:00`,
    arriving_at:
      index === leg.flights.length - 1 ? leg.arriveAt : `${leg.departAt.slice(0, 10)}T11:00:00`,
    marketing_carrier: { iata_code: flight.slice(0, 2), name: flight.slice(0, 2) },
    marketing_carrier_flight_number: flight.slice(2),
    operating_carrier: { iata_code: flight.slice(0, 2) },
  }));
}

export function duffelOfferOf(offer: FlightOffer) {
  return {
    id: `off_${offer.airline.replace(/\W/g, '')}_${String(offer.totalMinor)}`,
    live_mode: false,
    total_amount: amountOf(offer.totalMinor),
    total_currency: offer.currency,
    base_amount: amountOf(offer.totalMinor),
    tax_amount: '0.00',
    expires_at: offer.expiresAt.toISOString(),
    owner: { iata_code: 'XX', name: offer.airline },
    slices: offer.legs.map((leg) => ({
      id: `sli_${leg.from}${leg.to}`,
      origin: { iata_code: leg.from, type: 'airport' },
      destination: { iata_code: leg.to, type: 'airport' },
      duration: durationOf(leg.durationMinutes),
      segments: segmentsOf(leg),
    })),
    passengers: [{ id: 'pas_1', type: 'adult' }],
  };
}
