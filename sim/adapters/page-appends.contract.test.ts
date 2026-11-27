import { describePageAppendsContract } from '@uw/harness/port-contracts/page-appends';
import { createSimPageAppends, simPrincipalWith } from './page-appends.ts';

const area = '30-39';
const pageIds = [
  'c7000000-0000-4000-8000-000000000011',
  'c7000000-0000-4000-8000-000000000012',
  'c7000000-0000-4000-8000-000000000013',
];

describePageAppendsContract('the recording sim page appends', async () => {
  const pageAppends = createSimPageAppends();
  let added = 0;
  return {
    pageAppends,
    area,
    addPage: async (bodyMd) => {
      const pageId = pageIds[added] ?? '';
      added += 1;
      pageAppends.addPage(pageId, area, bodyMd);
      return pageId;
    },
    page: async (pageId) => pageAppends.page(pageId),
    person: async (role) => simPrincipalWith(role, area),
  };
});
