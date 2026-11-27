import { describe, expect, it } from 'vitest';
import lock from './contract-lock.json' with { type: 'json' };
import {
  assistantResearchKindSchema,
  assistantResearchRefusalSchema,
  flightCabinSchema,
  webAddressRefusalSchema,
} from './assistant-research.ts';
import { untrustedSourceSchema } from './closed-sets.ts';
import { eventEvidenceSchemas } from './event-evidence.ts';
import { eventNameSchema } from './events.ts';
import { schemaRegistry } from './registry.ts';
import { verbIo } from './verb-io.ts';
import { findVerb } from './verbs.ts';
import { CONTRACT_VERSION } from './version.ts';

const id = '00000000-0000-4000-8000-0000000000f1';
const other = '00000000-0000-4000-8000-0000000000f2';

describe('PA-19 the research contracts', () => {
  it('registers search_web, read_web_page and find_flights in the assistant group, served only in a turn', () => {
    for (const name of ['search_web', 'read_web_page', 'find_flights']) {
      const verb = findVerb(name);
      expect(verb?.group).toBe('assistant');
      expect(verb?.servedInV1).toBe(false);
      expect(verb?.grant).toBeNull();
    }
  });

  it('records research as a count with ids and a kind, never the query, address or route', () => {
    expect(eventNameSchema.safeParse('assistant_research_used').success).toBe(true);
    const used = eventEvidenceSchemas.assistant_research_used;
    expect(used.safeParse({ requestId: id, turnId: other, kind: 'web_search' }).success).toBe(true);
    const withQuery = { requestId: id, turnId: other, kind: 'web_search', query: 'flights' };
    expect(used.safeParse(withQuery).success).toBe(false);
    const withUrl = { requestId: id, turnId: other, kind: 'page_read', url: 'https://a.example' };
    expect(used.safeParse(withUrl).success).toBe(false);
  });
});

describe('PA-19 the research closed sets', () => {
  it('closes the research kinds, refusals, address refusals and cabins', () => {
    expect([...assistantResearchKindSchema.options]).toEqual([
      'web_search',
      'page_read',
      'page_rendered',
      'flight_search',
    ]);
    expect([...assistantResearchRefusalSchema.options]).toEqual([
      'research_capped',
      'address_blocked',
      'address_not_offered',
      'page_unreadable',
      'research_refused',
      'research_unavailable',
      'research_not_wired',
    ]);
    expect([...webAddressRefusalSchema.options]).toEqual([
      'not_web',
      'credentials',
      'port',
      'private_address',
      'too_long',
      'too_many_redirects',
    ]);
    expect([...flightCabinSchema.options]).toEqual([
      'economy',
      'premium_economy',
      'business',
      'first',
    ]);
    for (const key of [
      'assistant-research-kind',
      'assistant-research-refusal',
      'web-address-refusal',
      'flight-cabin',
    ]) {
      expect(schemaRegistry[key]).toBeDefined();
    }
  });
});

describe('PA-19 the research untrusted sources', () => {
  it('fences web pages, search results and flight offers as their own untrusted sources', () => {
    for (const source of ['web_page', 'search_result', 'flight_offer']) {
      expect(untrustedSourceSchema.safeParse(source).success).toBe(true);
    }
  });
});

describe('PA-19 the research verb inputs', () => {
  it('takes a bounded search query', () => {
    const search = verbIo.search_web.input;
    expect(search.safeParse({ query: 'Lausanne conference 2027' }).success).toBe(true);
    expect(search.safeParse({ query: 'x', count: 10 }).success).toBe(true);
    expect(search.safeParse({ query: '' }).success).toBe(false);
    expect(search.safeParse({ query: 'x'.repeat(401) }).success).toBe(false);
    expect(search.safeParse({ query: 'x', count: 11 }).success).toBe(false);
  });

  it('takes one bounded address to read', () => {
    const read = verbIo.read_web_page.input;
    expect(read.safeParse({ url: 'https://example.org/agenda' }).success).toBe(true);
    expect(read.safeParse({ url: `https://example.org/${'a'.repeat(2048)}` }).success).toBe(false);
    expect(read.safeParse({ url: 'https://example.org', render: true }).success).toBe(false);
  });

  it('takes airport codes, dates, a passenger count and a cabin', () => {
    const flights = verbIo.find_flights.input;
    const query = { origin: 'NBO', destination: 'GVA', departDate: '2027-03-01' };
    expect(flights.safeParse(query).success).toBe(true);
    const full = { ...query, returnDate: '2027-03-06', passengers: 2, cabin: 'economy' };
    expect(flights.safeParse(full).success).toBe(true);
    expect(flights.safeParse({ ...query, origin: 'nbo' }).success).toBe(false);
    expect(flights.safeParse({ ...query, passengers: 10 }).success).toBe(false);
    expect(flights.safeParse({ ...query, cabin: 'suite' }).success).toBe(false);
    expect(flights.safeParse({ ...query, book: true }).success).toBe(false);
  });
});

describe('the research contract version', () => {
  it('was published at 14.25.0 with the research sets locked', () => {
    expect(lock.versions.map((version) => version.version)).toContain(CONTRACT_VERSION);
    const entry = lock.versions.find((version) => version.version === '14.25.0');
    const sets: Record<string, readonly string[]> = entry?.sets ?? {};
    expect(sets['untrusted-source']).toContain('flight_offer');
    expect(sets['assistant-research-kind']).toContain('page_rendered');
  });
});
