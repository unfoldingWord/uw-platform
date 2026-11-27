import { describe, expect, it } from 'vitest';
import { ingestPrincipal, systemPrincipal } from '@uw/core/principal';
import { testServer } from '@uw/db/test-database';
import { allEvents } from '../../testing/commands.ts';
import { withTurnRig, type TurnRig } from '../../testing/turn-rig.ts';
import { completion, run } from '../../testing/turn-script.ts';

const principals = { system: systemPrincipal(), ingest: ingestPrincipal() };
const site = 'https://btc2027.example.org/';
const tickets = `${site}tickets`;
const route = {
  origin: 'NBO',
  destination: 'GVA',
  departDate: '2027-03-01',
  returnDate: '2027-03-06',
  passengers: 1,
  cabin: 'economy',
} as const;
const reply = `The conference is in Geneva (${site}). An early bird ticket is 250 CHF (${tickets}). The cheapest flight is USD 842.10 on Kenya Airways.`;

function seed(rig: TurnRig): void {
  rig.research.addResults('Geneva translation conference 2027 tickets', [
    { title: 'Bible Translation Conference 2027', url: site, snippet: 'Geneva, March 2027' },
  ]);
  rig.research.addPage(tickets, {
    title: 'Tickets',
    text: 'Early bird 250 CHF',
    needsRendering: true,
  });
  rig.research.addOffers(route, [
    {
      airline: 'Kenya Airways',
      totalMinor: 84_210,
      currency: 'USD',
      expiresAt: new Date(rig.start.getTime() + 3_600_000),
      legs: [
        {
          from: 'NBO',
          to: 'GVA',
          departAt: '2027-03-01T08:00:00',
          arriveAt: '2027-03-01T18:10:00',
          durationMinutes: 610,
          flights: ['KQ100'],
        },
      ],
    },
  ]);
}

function calls() {
  return [
    {
      id: 'call_1',
      name: 'search_web',
      args: { query: 'Geneva translation conference 2027 tickets' },
    },
    { id: 'call_2', name: 'read_web_page', args: { url: tickets } },
    {
      id: 'call_3',
      name: 'read_web_page',
      args: { url: 'http://169.254.169.254/latest/meta-data/' },
    },
    {
      id: 'call_4',
      name: 'find_flights',
      args: {
        origin: 'NBO',
        destination: 'GVA',
        departDate: '2027-03-01',
        returnDate: '2027-03-06',
      },
    },
  ];
}

async function researchesAndCites(rig: TurnRig): Promise<void> {
  seed(rig);
  rig.gateway.respondNext(200, completion(null, calls()));
  rig.gateway.respondNext(200, completion(reply, []));
  await rig.direct('Find me a conference itinerary with ticket prices', 8931);
  expect(await run(rig, 0)).toBe('sent');
  const sent = rig.zulip.messages().filter((message) => message.type === 'direct');
  expect(sent.map((message) => message.content)).toEqual([reply]);
  const hosts = rig.research.requests().map((request) => new URL(request.url).host);
  expect(hosts).toContain('api.search.brave.com');
  expect(hosts).toContain('api.duffel.com');
  expect(hosts).not.toContain('169.254.169.254');
  expect(rig.research.requests().some((request) => request.url.includes('/air/orders'))).toBe(
    false,
  );
  expect(rig.research.browser.rendered()).toEqual([tickets]);
  const events = await allEvents(rig.db, rig.harnessId);
  const kinds = events
    .filter((event) => event.name === 'assistant_research_used')
    .map((event) => event.evidence['kind']);
  expect(kinds).toEqual(['web_search', 'page_read', 'page_rendered', 'page_read', 'flight_search']);
  expect(JSON.stringify(events)).not.toContain('btc2027');
}

describe.skipIf(!testServer)('PA-19 the hosted turn researches through the assistant host', () => {
  it('searches, reads, renders once, finds flights, refuses a metadata address and replies with sources', () =>
    withTurnRig(principals, researchesAndCites));
});
