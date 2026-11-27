import { FLIGHT_OFFERS_MOST, WEB_PAGE_TEXT_MOST } from '@uw/contracts';
import { describe, expect, it } from 'vitest';
import type { FlightOffer, FlightQuery, Research, WebResult } from '../ports.ts';
import { describeNotWired } from './not-wired-cases.ts';

export type SeededPage = {
  readonly title: string;
  readonly text: string;
  readonly needsRendering?: boolean;
};

export type ResearchSubject = {
  readonly research: Research;
  results(query: string, results: readonly WebResult[]): Promise<void>;
  page(url: string, page: SeededPage): Promise<void>;
  redirect(from: string, to: string): Promise<void>;
  offers(query: FlightQuery, offers: readonly FlightOffer[]): Promise<void>;
};

type Open = () => Promise<ResearchSubject>;

const agenda = 'https://conference.example.org/agenda';
const route: FlightQuery = {
  origin: 'NBO',
  destination: 'GVA',
  departDate: '2027-03-01',
  returnDate: '2027-03-06',
  passengers: 1,
  cabin: 'economy',
};

function resultOf(n: number): WebResult {
  return {
    title: `Translation conference ${String(n)}`,
    url: `https://conference.example.org/${String(n)}`,
    snippet: `Snippet ${String(n)}`,
  };
}

function offerOf(totalMinor: number, airline: string): FlightOffer {
  return {
    airline,
    totalMinor,
    currency: 'USD',
    expiresAt: new Date('2027-02-01T10:30:00.000Z'),
    legs: [
      {
        from: 'NBO',
        to: 'GVA',
        departAt: '2027-03-01T08:00:00',
        arriveAt: '2027-03-01T18:10:00',
        durationMinutes: 610,
        flights: ['KQ100', 'KL1234'],
      },
    ],
  };
}

function describeSearch(open: Open): void {
  it('answers a search with titles, addresses and snippets, at most the count asked', async () => {
    const subject = await open();
    const results = [1, 2, 3, 4].map(resultOf);
    await subject.results('translation conference 2027', results);
    const found = await subject.research.search({ query: 'translation conference 2027', count: 3 });
    expect(found).toEqual({ outcome: 'found', results: results.slice(0, 3) });
  });

  it('answers a search with nothing found as an empty list', async () => {
    const subject = await open();
    const found = await subject.research.search({ query: 'nothing matches this', count: 5 });
    expect(found).toEqual({ outcome: 'found', results: [] });
  });
}

function describeReads(open: Open): void {
  it('reads the text of a public page without rendering it', async () => {
    const subject = await open();
    await subject.page(agenda, { title: 'Agenda', text: 'Day one: opening session.' });
    const read = await subject.research.read({ url: agenda, mayRender: true });
    expect(read).toMatchObject({ outcome: 'read', url: agenda, title: 'Agenda', rendered: false });
    expect(read.outcome === 'read' ? read.text : '').toContain('Day one: opening session.');
  });

  it('renders a page whose text needs a browser only when rendering is allowed', async () => {
    const subject = await open();
    await subject.page(agenda, {
      title: 'Tickets',
      text: 'Early bird 250 CHF',
      needsRendering: true,
    });
    expect(await subject.research.read({ url: agenda, mayRender: false })).toEqual({
      outcome: 'unreadable',
    });
    const read = await subject.research.read({ url: agenda, mayRender: true });
    expect(read).toMatchObject({ outcome: 'read', rendered: true });
    expect(read.outcome === 'read' ? read.text : '').toContain('Early bird 250 CHF');
  });

  it('cuts a long page to the bound and says so', async () => {
    const subject = await open();
    await subject.page(agenda, { title: 'Long', text: 'word '.repeat(WEB_PAGE_TEXT_MOST) });
    const read = await subject.research.read({ url: agenda, mayRender: false });
    expect(read).toMatchObject({ outcome: 'read', truncated: true });
    expect(read.outcome === 'read' ? read.text.length : Infinity).toBeLessThanOrEqual(
      WEB_PAGE_TEXT_MOST,
    );
  });

  it('follows a redirect to a public page', async () => {
    const subject = await open();
    await subject.page(agenda, { title: 'Agenda', text: 'Moved here.' });
    await subject.redirect('https://conference.example.org/old', agenda);
    const read = await subject.research.read({
      url: 'https://conference.example.org/old',
      mayRender: false,
    });
    expect(read).toMatchObject({ outcome: 'read', url: agenda });
  });
}

const blocked: readonly (readonly [string, string])[] = [
  ['http://127.0.0.1/admin', 'private_address'],
  ['http://169.254.169.254/latest/meta-data/', 'private_address'],
  ['http://metadata.google.internal/computeMetadata/v1/', 'private_address'],
  ['http://10.0.0.5/', 'private_address'],
  ['http://[::1]/', 'private_address'],
  ['http://localhost/', 'private_address'],
  ['http://2130706433/', 'private_address'],
  ['https://user:secret@conference.example.org/', 'credentials'],
  ['https://conference.example.org:8443/', 'port'],
  ['file:///etc/passwd', 'not_web'],
  ['ftp://conference.example.org/', 'not_web'],
];

function describeGuard(open: Open): void {
  it.each(blocked)('refuses %s as %s and reaches nothing', async (url, why) => {
    const subject = await open();
    expect(await subject.research.read({ url, mayRender: true })).toEqual({
      outcome: 'blocked',
      why,
    });
  });

  it('refuses a redirect to a private address', async () => {
    const subject = await open();
    await subject.redirect('https://conference.example.org/go', 'http://169.254.169.254/');
    const read = await subject.research.read({
      url: 'https://conference.example.org/go',
      mayRender: true,
    });
    expect(read).toEqual({ outcome: 'blocked', why: 'private_address' });
  });

  it('refuses a fourth redirect', async () => {
    const subject = await open();
    const hops = [0, 1, 2, 3, 4].map((n) => `https://conference.example.org/hop${String(n)}`);
    for (const [index, hop] of hops.slice(0, -1).entries()) {
      await subject.redirect(hop, hops[index + 1] ?? agenda);
    }
    await subject.page(hops.at(-1) ?? agenda, { title: 'End', text: 'Too far.' });
    const read = await subject.research.read({ url: hops[0] ?? agenda, mayRender: true });
    expect(read).toEqual({ outcome: 'blocked', why: 'too_many_redirects' });
  });
}

function describeFlights(open: Open): void {
  it('answers offers cheapest first, at most the bound, and never books', async () => {
    const subject = await open();
    const offers = Array.from({ length: FLIGHT_OFFERS_MOST + 2 }, (_, n) =>
      offerOf(90_000 - n * 1_000, `Airline ${String(n)}`),
    );
    await subject.offers(route, offers);
    const found = await subject.research.flights(route);
    expect(found.outcome).toBe('offered');
    const prices = found.outcome === 'offered' ? found.offers.map((offer) => offer.totalMinor) : [];
    expect(prices).toHaveLength(FLIGHT_OFFERS_MOST);
    expect(prices).toEqual([...prices].sort((a, b) => a - b));
    expect(prices[0]).toBe(90_000 - (FLIGHT_OFFERS_MOST + 1) * 1_000);
  });

  it('answers a route with no offers as an empty list', async () => {
    const subject = await open();
    const found = await subject.research.flights({ ...route, destination: 'LHR' });
    expect(found).toEqual({ outcome: 'offered', offers: [] });
  });
}

export function describeResearchContract(adapter: string, open: Open): void {
  describe(`DX-3 research port contract on ${adapter}`, () => {
    describeSearch(open);
    describeReads(open);
    describeGuard(open);
    describeFlights(open);
  });
}

export function describeResearchNotWired(adapter: string, research: Research): void {
  describeNotWired('research', adapter, research, {
    search: true,
    read: true,
    flights: true,
  } satisfies Record<keyof Research, true>);
}
