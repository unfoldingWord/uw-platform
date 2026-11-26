import { RESOURCES_COLLECTION_KEY, WEBSITES_VIEW_ID } from '@uw/contracts';
import { all, condition, fm, option, relation, shown, titleOnPage } from './parts.ts';
import type { BuiltIn } from './seed-types.ts';

const RESOURCES_COLLECTION_ID = 'c0110000-0000-4000-8000-000000000007';
const ALL_RESOURCES_VIEW_ID = 'c0110000-0000-4000-8000-000000000702';

const listed = shown(
  'name',
  'kind',
  'address',
  'owner',
  'serves_portfolio',
  'serves_program',
  'serves_project',
);

export const resourcesCollection: BuiltIn = {
  id: RESOURCES_COLLECTION_ID,
  definition: {
    key: RESOURCES_COLLECTION_KEY,
    name: 'Resources',
    jdArea: '00-09',
    rowSource: 'pages',
    pageType: 'resource',
    description:
      'The websites and apps the organization maintains, each related to the portfolios, programs and projects it serves. File each in the area of what it serves.',
    locked: true,
    properties: [
      titleOnPage,
      {
        key: 'kind',
        name: 'Kind',
        source: fm,
        config: {
          type: 'select',
          options: [option('website', 'Website'), option('mobile_app', 'Mobile app')],
        },
      },
      { key: 'address', name: 'Address', source: fm, config: { type: 'url' } },
      {
        key: 'owner',
        name: 'Owner',
        source: fm,
        config: { type: 'person', multiple: false },
      },
      relation('serves_portfolio', 'Serves portfolios', 'portfolio', true),
      relation('serves_program', 'Serves programs', 'program', true),
      relation('serves_project', 'Serves projects', 'project', true),
    ],
  },
  views: [
    {
      id: WEBSITES_VIEW_ID,
      settings: {
        name: 'Websites',
        layout: 'table',
        scope: 'shared',
        properties: listed,
        filter: all(condition('kind', 'is', 'website')),
        sorts: [{ property: 'name', direction: 'asc' }],
      },
    },
    {
      id: ALL_RESOURCES_VIEW_ID,
      settings: {
        name: 'All resources',
        layout: 'table',
        scope: 'shared',
        properties: listed,
        sorts: [{ property: 'name', direction: 'asc' }],
      },
    },
  ],
};
