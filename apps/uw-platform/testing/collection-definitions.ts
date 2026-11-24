import { collectionDefinitionSchema, type CollectionDefinition } from '@uw/contracts';

const title = {
  key: 'name',
  name: 'Name',
  config: { type: 'title' },
  source: { kind: 'column', column: 'title' },
};
const fm = { kind: 'frontmatter' } as const;
const derived = { kind: 'derived' } as const;
const financeOnly = { steward: '20-29', role: 'viewer', owner: false } as const;

export const testPortfolio: CollectionDefinition = collectionDefinitionSchema.parse({
  key: 'tportfolio',
  name: 'Portfolios',
  jdArea: '60-69',
  rowSource: 'pages',
  pageType: 'entry',
  properties: [
    title,
    {
      key: 'cost',
      name: 'Cost',
      source: fm,
      config: { type: 'number' },
      classification: 'restricted',
      rule: financeOnly,
    },
    {
      key: 'cost_total',
      name: 'Cost total',
      source: derived,
      config: { type: 'computed', computed: { function: 'sum', inputs: ['cost'] } },
    },
  ],
});

const phase = {
  key: 'phase',
  name: 'Phase',
  source: fm,
  config: {
    type: 'status',
    options: [
      { id: 'idea', name: 'Idea', group: 'to_do' },
      { id: 'running', name: 'Running', group: 'in_progress' },
      { id: 'closed', name: 'Closed', group: 'complete' },
    ],
  },
};

const relation = { type: 'relation', relation: { target: 'tportfolio', multiple: false } };

export const testProgram: CollectionDefinition = collectionDefinitionSchema.parse({
  key: 'tprogram',
  name: 'Programs',
  jdArea: '60-69',
  rowSource: 'pages',
  pageType: 'entry',
  properties: [
    title,
    phase,
    { key: 'lead', name: 'Lead', source: fm, config: { type: 'person', multiple: true } },
    { key: 'due', name: 'Due', source: fm, config: { type: 'date' } },
    { key: 'size', name: 'Size', source: fm, config: { type: 'text' } },
    { key: 'portfolio', name: 'Portfolio', source: derived, config: relation },
    {
      key: 'portfolio_cost',
      name: 'Portfolio cost',
      source: derived,
      config: {
        type: 'rollup',
        rollup: { relation: 'portfolio', property: 'cost', function: 'sum' },
      },
    },
    {
      key: 'portfolio_count',
      name: 'Portfolios',
      source: derived,
      config: {
        type: 'rollup',
        rollup: { relation: 'portfolio', property: null, function: 'count' },
      },
    },
    {
      key: 'portfolio_total',
      name: 'Portfolio total',
      source: derived,
      config: {
        type: 'rollup',
        rollup: { relation: 'portfolio', property: 'cost_total', function: 'sum' },
      },
    },
    {
      key: 'budget',
      name: 'Budget',
      source: derived,
      config: { type: 'read_through', feed: 'budget' },
    },
    {
      key: 'days_left',
      name: 'Days left',
      source: derived,
      config: { type: 'computed', computed: { function: 'date_until', inputs: ['due'] } },
    },
  ],
});
