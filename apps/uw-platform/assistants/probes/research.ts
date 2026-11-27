import { daysAfterDate, formatDate } from '@uw/core/dates';
import type { FlightOffers } from '@uw/harness';
import { braveSearch } from '../research/brave.ts';
import { researchConfigOf } from '../research/config.ts';
import { duffelFlights } from '../research/duffel.ts';
import { readPage } from '../research/page-read.ts';
import { checked, failed, skipped, type ProbeResult } from './report.ts';
import { bindingsOf, errorName, notConfigured, setting, type ProbeDeps } from './setup.ts';

const REBINDING_NAME = 'http://localtest.me/';
const METADATA = 'http://169.254.169.254/latest/meta-data/';
const FLIGHT_DAYS_AHEAD = 60;

async function searchProbe(deps: ProbeDeps): Promise<ProbeResult> {
  const config = researchConfigOf(bindingsOf(deps.env));
  if (config.braveKey === null)
    return skipped('s12.1', notConfigured(deps.env, ['BRAVE_SEARCH_API_KEY']));
  const found = await braveSearch(
    { apiKey: config.braveKey, fetcher: deps.fetcher },
    { query: 'unfoldingWord Bible translation', count: 3 },
  );
  if (found.outcome !== 'found') return failed('s12.1', `Brave answered ${found.outcome}`);
  const https = found.results.filter((result) => result.url.startsWith('https://')).length;
  return checked(
    's12.1',
    https > 0,
    `${String(found.results.length)} results, ${String(https)} https`,
  );
}

async function readProbe(deps: ProbeDeps, url: string): Promise<ProbeResult> {
  const read = await readPage({ fetcher: deps.fetcher, browser: null }, { url, mayRender: false });
  if (read.outcome !== 'read') return failed('s12.2', `${url} answered ${read.outcome}`);
  return checked('s12.2', read.text.length > 0, `${url}: ${String(read.text.length)} characters`);
}

async function guardProbe(deps: ProbeDeps): Promise<ProbeResult> {
  const reader = { fetcher: deps.fetcher, browser: null };
  const metadata = await readPage(reader, { url: METADATA, mayRender: false });
  const rebinding = await readPage(reader, { url: REBINDING_NAME, mayRender: false });
  const blocked = (outcome: typeof metadata) =>
    outcome.outcome === 'blocked' && outcome.why === 'private_address';
  const detail = `metadata ${metadata.outcome}, a public name resolving to 127.0.0.1 ${rebinding.outcome}`;
  return checked('s12.3', blocked(metadata) && blocked(rebinding), detail);
}

function offersDetail(found: FlightOffers): string {
  if (found.outcome !== 'offered') return `Duffel answered ${found.outcome}`;
  const [first] = found.offers;
  const cheapest = first === undefined ? 'none' : `${String(first.totalMinor)} ${first.currency}`;
  return `${String(found.offers.length)} offers, cheapest ${cheapest} minor units`;
}

async function flightsProbe(deps: ProbeDeps): Promise<ProbeResult> {
  const config = researchConfigOf(bindingsOf(deps.env));
  if (config.duffelToken === null)
    return skipped('s12.4', notConfigured(deps.env, ['DUFFEL_ACCESS_TOKEN']));
  const departDate = daysAfterDate(formatDate(deps.now()), FLIGHT_DAYS_AHEAD);
  const found = await duffelFlights(
    { accessToken: config.duffelToken, fetcher: deps.fetcher },
    {
      origin: 'LHR',
      destination: 'JFK',
      departDate,
      returnDate: null,
      passengers: 1,
      cabin: 'economy',
    },
  );
  const ok = found.outcome === 'offered' && found.offers.length > 0;
  return checked('s12.4', ok, offersDetail(found));
}

async function guarded(id: string, probe: () => Promise<ProbeResult>): Promise<ProbeResult> {
  try {
    return await probe();
  } catch (error) {
    return failed(id, errorName(error));
  }
}

function pageReadProbes(deps: ProbeDeps): Promise<ProbeResult>[] {
  const url = (setting(deps.env, 'PROBE_WEB_PAGE') ?? '').trim();
  if (url === '') {
    const why = notConfigured(deps.env, ['PROBE_WEB_PAGE']);
    return [Promise.resolve(skipped('s12.2', why)), Promise.resolve(skipped('s12.3', why))];
  }
  return [guarded('s12.2', () => readProbe(deps, url)), guarded('s12.3', () => guardProbe(deps))];
}

export async function researchProbes(deps: ProbeDeps): Promise<ProbeResult[]> {
  const [read, guard] = pageReadProbes(deps);
  return [
    await guarded('s12.1', () => searchProbe(deps)),
    ...(read === undefined || guard === undefined ? [] : [await read, await guard]),
    await guarded('s12.4', () => flightsProbe(deps)),
  ];
}
