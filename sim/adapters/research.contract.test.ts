import { describeResearchContract } from '@uw/harness/port-contracts/research';
import { createSimResearch } from './research.ts';

describeResearchContract('the scripted sim research', async () => {
  const research = createSimResearch();
  return {
    research,
    results: async (query, results) => research.addResults(query, results),
    page: async (url, page) => research.addPage(url, page),
    redirect: async (from, to) => research.addRedirect(from, to),
    offers: async (query, offers) => research.addOffers(query, offers),
  };
});
