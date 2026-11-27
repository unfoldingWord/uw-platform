import { describeResearchContract } from '@uw/harness/port-contracts/research';
import { fakeResearch } from '../assistants/research/testing/fake-research.ts';
import { platformResearch } from './research.ts';

describeResearchContract(
  'Brave, plain fetch, Browser Run and Duffel over recorded shapes',
  async () => {
    const fake = fakeResearch();
    return {
      research: platformResearch({
        fetcher: fake.fetch,
        braveKey: fake.braveKey,
        duffelToken: fake.duffelToken,
        browser: fake.browser,
      }),
      results: async (query, results) => fake.addResults(query, results),
      page: async (url, page) => fake.addPage(url, page),
      redirect: async (from, to) => fake.addRedirect(from, to),
      offers: async (query, offers) => fake.addOffers(query, offers),
    };
  },
);
