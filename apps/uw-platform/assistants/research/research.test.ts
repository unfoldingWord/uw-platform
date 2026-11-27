import { describe, expect, it } from 'vitest';
import { platformResearch } from '../../ports/research.ts';
import { BRAVE_SEARCH_URL } from './brave.ts';
import { DUFFEL_API } from './duffel.ts';
import { fakeResearch, type FakeResearch } from './testing/fake-research.ts';

const agenda = 'https://btc2027.example.org/agenda';
const route = {
  origin: 'NBO',
  destination: 'GVA',
  departDate: '2027-03-01',
  returnDate: '2027-03-06',
  passengers: 2,
  cabin: 'economy',
} as const;

function researchOn(fake: FakeResearch, browser = true) {
  return platformResearch({
    fetcher: fake.fetch,
    braveKey: fake.braveKey,
    duffelToken: fake.duffelToken,
    browser: browser ? fake.browser : null,
  });
}

function hosts(fake: FakeResearch): readonly string[] {
  return fake.requests().map((request) => new URL(request.url).host);
}

describe('PA-19 the Brave search client', () => {
  it('asks Brave with the subscription token and strips its highlighting', async () => {
    const fake = fakeResearch();
    fake.addResults('geneva conference', [
      { title: 'Geneva &amp; you', url: 'https://a.example.org/', snippet: 'March 2027' },
      { title: 'Not the web', url: 'javascript:alert(1)', snippet: 'x' },
    ]);
    const found = await researchOn(fake).search({ query: 'geneva conference', count: 5 });
    expect(found).toEqual({
      outcome: 'found',
      results: [{ title: 'Geneva & you', url: 'https://a.example.org/', snippet: 'March 2027' }],
    });
    const [call] = fake.requests();
    expect(call?.url.startsWith(`${BRAVE_SEARCH_URL}?`)).toBe(true);
    expect(call?.method).toBe('GET');
    expect(call?.headers['x-subscription-token']).toBe(fake.braveKey);
  });

  it('answers refused on a rejected key and unavailable on a rate limit', async () => {
    const fake = fakeResearch();
    fake.failNext('api.search.brave.com', 401);
    expect(await researchOn(fake).search({ query: 'x', count: 1 })).toEqual({ outcome: 'refused' });
    fake.failNext('api.search.brave.com', 429);
    expect(await researchOn(fake).search({ query: 'x', count: 1 })).toEqual({
      outcome: 'unavailable',
    });
  });
});

describe('PA-19 the page reader', () => {
  it('refuses a public name that resolves to a private address, and never fetches it', async () => {
    const fake = fakeResearch();
    fake.resolve('rebind.example.org', ['127.0.0.1']);
    fake.addPage('https://rebind.example.org/', { title: 'x', text: 'secret' });
    const read = await researchOn(fake).read({
      url: 'https://rebind.example.org/',
      mayRender: true,
    });
    expect(read).toEqual({ outcome: 'blocked', why: 'private_address' });
    expect(hosts(fake)).not.toContain('rebind.example.org');
  });

  it('refuses a name with a private IPv6 address beside a public IPv4 one', async () => {
    const fake = fakeResearch();
    fake.resolve('dual.example.org', ['93.184.215.14', 'fd00::1']);
    const read = await researchOn(fake).read({ url: 'https://dual.example.org/', mayRender: true });
    expect(read).toEqual({ outcome: 'blocked', why: 'private_address' });
  });
});

describe('PA-19 the page reader reads text', () => {
  it('follows no redirect by itself', async () => {
    const fake = fakeResearch();
    fake.addRedirect('https://btc2027.example.org/old', agenda);
    fake.addPage(agenda, { title: 'Agenda', text: 'Opening session at nine.' });
    await researchOn(fake).read({ url: 'https://btc2027.example.org/old', mayRender: false });
    const reads = fake
      .requests()
      .filter((request) => new URL(request.url).host === 'btc2027.example.org');
    expect(reads.map((request) => request.redirect)).toEqual(['manual', 'manual']);
  });

  it('reads plain text and refuses a file it cannot read as text', async () => {
    const fake = fakeResearch();
    fake.addPage('https://a.example.org/notes.txt', {
      title: '',
      text: 'Plain notes',
      contentType: 'text/plain',
    });
    fake.addPage('https://a.example.org/a.pdf', {
      title: '',
      text: '%PDF',
      contentType: 'application/pdf',
    });
    const research = researchOn(fake);
    expect(
      await research.read({ url: 'https://a.example.org/notes.txt', mayRender: false }),
    ).toMatchObject({
      outcome: 'read',
      text: 'Plain notes',
    });
    expect(await research.read({ url: 'https://a.example.org/a.pdf', mayRender: false })).toEqual({
      outcome: 'unreadable',
    });
  });
});

describe('PA-19 the page reader renders only what needs it, or gives up', () => {
  it('renders a script-only page once through the Browser Run binding, and not without it', async () => {
    const fake = fakeResearch();
    fake.addPage(agenda, { title: 'Tickets', text: 'Early bird 250 CHF', needsRendering: true });
    const read = await researchOn(fake).read({ url: agenda, mayRender: true });
    expect(read).toMatchObject({ outcome: 'read', rendered: true, title: 'Tickets' });
    expect(fake.browser.rendered()).toEqual([agenda]);
    expect(await researchOn(fake, false).read({ url: agenda, mayRender: true })).toEqual({
      outcome: 'unreadable',
    });
    expect(fake.browser.rendered()).toEqual([agenda]);
  });

  it('answers unavailable when the site cannot be reached', async () => {
    const research = platformResearch({
      fetcher: async (input) => {
        if (String(input).startsWith('https://cloudflare-dns.com/')) {
          return fakeResearch().fetch(input);
        }
        throw new TypeError('network down');
      },
      braveKey: null,
      duffelToken: null,
      browser: null,
    });
    expect(await research.read({ url: agenda, mayRender: false })).toEqual({
      outcome: 'unavailable',
    });
  });
});

describe('PA-19 a rendered page stays on the site that was checked', () => {
  it('keeps the browser on the checked address, so a script cannot send it to a private one', async () => {
    const fake = fakeResearch();
    const internal = 'http://10.0.0.5/admin';
    fake.addPage(agenda, {
      title: 'Tickets',
      text: 'Loading',
      needsRendering: true,
      navigatesTo: internal,
    });
    fake.addPage(internal, { title: 'Admin', text: 'internal secrets' });
    const read = await researchOn(fake).read({ url: agenda, mayRender: true });
    expect(JSON.stringify(read)).not.toContain('internal secrets');
    expect(fake.browser.rendered()).toEqual([agenda]);
  });

  it('keeps the browser off another public site the page sends it to', async () => {
    const fake = fakeResearch();
    const elsewhere = 'https://btc2027.example.org.attacker.example/fake-agenda';
    fake.addPage(agenda, {
      title: 'Tickets',
      text: 'Loading',
      needsRendering: true,
      navigatesTo: elsewhere,
    });
    const read = await researchOn(fake).read({ url: agenda, mayRender: true });
    expect(read).toMatchObject({ outcome: 'read', url: agenda, text: '# Tickets\n\nLoading' });
    expect(fake.browser.rendered()).toEqual([agenda]);
  });
});

const kenyaAirways = {
  airline: 'Kenya Airways',
  totalMinor: 168_420,
  currency: 'USD',
  expiresAt: new Date('2026-12-01T10:00:00.000Z'),
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

const requestedRoute = {
  data: {
    slices: [
      { origin: 'NBO', destination: 'GVA', departure_date: '2027-03-01' },
      { origin: 'GVA', destination: 'NBO', departure_date: '2027-03-06' },
    ],
    passengers: [{ type: 'adult' }, { type: 'adult' }],
    cabin_class: 'economy',
    max_connections: 2,
  },
};

describe('PA-19 the Duffel flights client', () => {
  it('asks for an offer request, then the cheapest offers, as Duffel v2, and never books', async () => {
    const fake = fakeResearch();
    fake.addOffers(route, [kenyaAirways]);
    const found = await researchOn(fake).flights(route);
    expect(found).toEqual({ outcome: 'offered', offers: [kenyaAirways] });
    const calls = fake.requests().map((request) => `${request.method} ${request.url}`);
    expect(calls).toEqual([
      `POST ${DUFFEL_API}/air/offer_requests?return_offers=false&supplier_timeout=15000`,
      `GET ${DUFFEL_API}/air/offers?offer_request_id=orq_000001&sort=total_amount&limit=8`,
    ]);
    const [requested] = fake.requests();
    expect(requested?.headers['duffel-version']).toBe('v2');
    expect(requested?.body).toEqual(requestedRoute);
  });

  it('answers refused when Duffel rejects the token', async () => {
    const fake = fakeResearch();
    fake.failNext('api.duffel.com', 401);
    expect(await researchOn(fake).flights(route)).toEqual({ outcome: 'refused' });
  });
});
