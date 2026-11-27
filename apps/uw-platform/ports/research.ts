import { notWiredCall, type Research } from '@uw/harness';
import { braveSearch } from '../assistants/research/brave.ts';
import type { ResearchConfig } from '../assistants/research/config.ts';
import { duffelFlights } from '../assistants/research/duffel.ts';
import type { Fetcher } from '../assistants/research/http.ts';
import { readPage } from '../assistants/research/page-read.ts';

export type ResearchDeps = ResearchConfig & { readonly fetcher: Fetcher };

export function platformResearch(deps: ResearchDeps): Research {
  const { fetcher, braveKey, duffelToken, browser } = deps;
  return {
    search: (query) =>
      braveKey === null
        ? notWiredCall('research', 'search')
        : braveSearch({ apiKey: braveKey, fetcher }, query),
    read: (request) => readPage({ fetcher, browser }, request),
    flights: (query) =>
      duffelToken === null
        ? notWiredCall('research', 'flights')
        : duffelFlights({ accessToken: duffelToken, fetcher }, query),
  };
}
