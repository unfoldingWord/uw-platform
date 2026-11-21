import {
  all,
  condition,
  derived,
  either,
  fm,
  money,
  option,
  relation,
  shown,
  status,
  titleOnPage,
} from './parts.ts';
import type { BuiltIn } from './seed-types.ts';

const AREA = '00-09';
const id = (n: number) => `c0110000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const health = {
  type: 'select',
  options: [
    option('on_track', 'On track', 'success'),
    option('at_risk', 'At risk', 'info'),
    option('off_track', 'Off track', 'held'),
  ],
};

const programPhase = {
  type: 'status',
  options: [
    status('idea', 'Idea', 'to_do'),
    status('planning', 'Planning', 'to_do'),
    status('pilot', 'Pilot', 'in_progress'),
    status('active', 'Active', 'in_progress'),
    status('sunsetting', 'Sunsetting', 'in_progress'),
    status('closed', 'Closed', 'complete'),
  ],
};

const projectPhase = {
  type: 'status',
  options: [
    status('proposed', 'Proposed', 'to_do'),
    status('scoping', 'Scoping', 'to_do'),
    status('funded', 'Funded', 'to_do'),
    status('underway', 'Underway', 'in_progress'),
    status('reporting', 'Reporting', 'in_progress'),
    status('complete', 'Complete', 'complete'),
    status('cancelled', 'Cancelled', 'complete'),
  ],
};

const okrStatus = {
  type: 'status',
  options: [
    status('not_started', 'Not started', 'to_do'),
    status('on_track', 'On track', 'in_progress'),
    status('achieved', 'Achieved', 'complete'),
    status('missed', 'Missed', 'complete'),
  ],
};

const tags = (...names: string[]) => ({
  type: 'multi_select',
  options: names.map((name) => option(name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name)),
});

const person = (key: string, name: string, multiple: boolean) => ({
  key,
  name,
  source: fm,
  config: { type: 'person', multiple },
});
const span = { key: 'duration', name: 'Duration', source: fm, config: { type: 'date_range' } };

export const portfolioCollection: BuiltIn = {
  id: id(3),
  definition: {
    key: 'portfolio',
    name: 'Portfolios',
    jdArea: AREA,
    rowSource: 'pages',
    pageType: 'portfolio',
    description: 'The portfolios of the strategic cascade, each carrying its strategic intent.',
    locked: true,
    properties: [
      titleOnPage,
      {
        key: 'strategic_intent',
        name: 'Strategic intent',
        source: fm,
        config: { type: 'text', multiline: true },
      },
      person('lead', 'Lead', false),
      relation('programs', 'Programs', 'program', true, 'portfolio'),
    ],
  },
  views: [
    {
      id: id(300),
      settings: {
        name: 'All portfolios',
        layout: 'list',
        scope: 'shared',
        properties: shown('name', 'lead'),
        sorts: [{ property: 'name', direction: 'asc' }],
      },
    },
  ],
};

export const programCollection: BuiltIn = {
  id: id(4),
  definition: {
    key: 'program',
    name: 'Program Portfolio',
    jdArea: AREA,
    rowSource: 'pages',
    pageType: 'program',
    description:
      'Programs are the budget plan’s cascade nodes. Money is read from the budget and edited only there.',
    locked: true,
    properties: [
      titleOnPage,
      { key: 'phase', name: 'Phase', source: fm, config: programPhase, section: 'Overview' },
      { key: 'health', name: 'Status', source: fm, config: health, section: 'Overview' },
      { ...person('lead', 'Program leader', false), section: 'Overview' },
      { ...person('team', 'Program team', true), section: 'Overview' },
      { ...span, section: 'Details' },
      {
        key: 'stakeholders',
        name: 'Stakeholders',
        source: fm,
        config: tags('Partner church', 'Translation team', 'Seminary', 'Mission agency'),
        section: 'Details',
        hide_when_empty: true,
      },
      {
        key: 'tags',
        name: 'Tags',
        source: fm,
        config: tags(
          'Translation',
          'Training',
          'Technology',
          'Content',
          'Field',
          'Research',
          'Advocacy',
          'Pilot',
        ),
        section: 'Details',
      },
      { ...relation('portfolio', 'Portfolio', 'portfolio', false), section: 'Details' },
      { ...relation('okrs', '2030 OKRs', 'okr', true), section: 'Details' },
      relation('projects', 'Projects', 'project', true, 'program'),
      {
        key: 'sage_program_id',
        name: 'Sage program ID',
        source: derived,
        section: 'Budget',
        config: { type: 'read_through', feed: 'sage_program_id' },
      },
      money('budget', 'Budget', 'budget'),
      money('actuals', 'Actuals', 'actuals'),
      money('income', 'Income by source', 'income_by_source'),
      money('balance', 'Balance', 'balance'),
    ],
  },
  views: [
    {
      id: id(401),
      settings: {
        name: 'By phase',
        layout: 'board',
        scope: 'shared',
        properties: shown('name', 'lead', 'health'),
        group: { property: 'phase', by: 'value' },
        manualOrder: true,
      },
    },
    {
      id: id(402),
      settings: {
        name: 'By portfolio',
        layout: 'board',
        scope: 'shared',
        properties: shown('name', 'phase'),
        group: { property: 'portfolio', by: 'value' },
        hideEmptyGroups: true,
      },
    },
    {
      id: id(403),
      settings: {
        name: 'Table',
        layout: 'table',
        scope: 'shared',
        properties: shown(
          'name',
          'phase',
          'health',
          'lead',
          'portfolio',
          'duration',
          'sage_program_id',
          'budget',
        ),
        sorts: [{ property: 'phase', direction: 'asc' }],
      },
    },
    {
      id: id(404),
      settings: {
        name: 'Programs by phase',
        layout: 'chart',
        scope: 'shared',
        group: { property: 'phase', by: 'status_group' },
        chart: { kind: 'donut', sum: null },
      },
    },
  ],
  templates: [
    {
      id: id(450),
      name: 'New Program',
      values: { phase: 'idea', health: 'on_track' },
      bodyMd: '## Purpose\n\n## Who it serves\n\n## How we will know it is working\n',
    },
  ],
};

const projectViews = [
  {
    id: id(501),
    settings: {
      name: 'By phase',
      layout: 'board',
      scope: 'shared',
      properties: shown('name', 'manager', 'program'),
      group: { property: 'phase', by: 'value' },
      manualOrder: true,
      hideEmptyGroups: false,
    },
  },
  {
    id: id(502),
    settings: {
      name: 'By program',
      layout: 'board',
      scope: 'shared',
      properties: shown('name', 'phase'),
      group: { property: 'program', by: 'value' },
      hideEmptyGroups: true,
    },
  },
  {
    id: id(503),
    settings: {
      name: 'By 2030 OKR',
      layout: 'board',
      scope: 'shared',
      properties: shown('name', 'phase'),
      group: { property: 'okrs', by: 'value' },
      hideEmptyGroups: true,
    },
  },
  {
    id: id(504),
    settings: {
      name: 'Table',
      layout: 'table',
      scope: 'shared',
      properties: shown(
        'name',
        'phase',
        'manager',
        'program',
        'portfolio',
        'duration',
        'field_cost',
        'remaining_need',
      ),
      sorts: [{ property: 'phase', direction: 'asc' }],
    },
  },
  {
    id: id(505),
    settings: {
      name: 'Training calendar',
      layout: 'calendar',
      scope: 'shared',
      dateProperty: 'duration',
      filter: all(condition('training_event_id', 'is_not_empty', null)),
    },
  },
  {
    id: id(506),
    settings: {
      name: 'My projects',
      layout: 'board',
      scope: 'shared',
      properties: shown('name', 'program'),
      group: { property: 'phase', by: 'status_group' },
      filter: either(
        condition('manager', 'contains', { kind: 'me' }),
        condition('team', 'contains', { kind: 'me' }),
      ),
    },
  },
  {
    id: id(507),
    settings: {
      name: 'Overdue',
      layout: 'table',
      scope: 'shared',
      properties: shown('name', 'manager', 'duration', 'phase'),
      filter: all(
        condition('duration', 'before', { kind: 'today' }),
        either(
          condition('phase', 'group_is', 'to_do'),
          condition('phase', 'group_is', 'in_progress'),
        ),
      ),
      sorts: [{ property: 'duration', direction: 'asc' }],
    },
  },
  {
    id: id(508),
    settings: {
      name: 'Underway',
      layout: 'board',
      scope: 'shared',
      properties: shown('name', 'manager'),
      group: { property: 'program', by: 'value' },
      filter: all(condition('phase', 'group_is', 'in_progress')),
      hideEmptyGroups: true,
    },
  },
  {
    id: id(509),
    settings: {
      name: 'By manager',
      layout: 'board',
      scope: 'shared',
      properties: shown('name', 'phase'),
      group: { property: 'manager', by: 'value' },
      hideEmptyGroups: true,
    },
  },
  {
    id: id(510),
    settings: {
      name: 'Gallery',
      layout: 'gallery',
      scope: 'shared',
      properties: shown('name', 'phase', 'program'),
      cover: true,
    },
  },
  {
    id: id(511),
    settings: {
      name: 'All projects',
      layout: 'list',
      scope: 'shared',
      properties: shown('name', 'phase', 'duration'),
      sorts: [{ property: 'name', direction: 'asc' }],
    },
  },
  {
    id: id(512),
    settings: {
      name: 'Projects by phase',
      layout: 'chart',
      scope: 'shared',
      group: { property: 'phase', by: 'value' },
      chart: { kind: 'bar', sum: null },
    },
  },
];

export const projectCollection: BuiltIn = {
  id: id(5),
  definition: {
    key: 'project',
    name: 'Projects',
    jdArea: AREA,
    rowSource: 'pages',
    pageType: 'project',
    description: 'Projects under a program. Money shows once budget lines attach to projects.',
    locked: true,
    properties: [
      titleOnPage,
      { key: 'phase', name: 'Phase', source: fm, config: projectPhase, section: 'Overview' },
      { ...person('manager', 'Project manager', false), section: 'Overview' },
      { ...person('team', 'Project team', true), section: 'Overview' },
      { ...relation('program', 'Program', 'program', false), section: 'Overview' },
      {
        key: 'portfolio',
        name: 'Portfolio',
        source: derived,
        section: 'Overview',
        config: {
          type: 'rollup',
          rollup: { relation: 'program', property: 'portfolio', function: 'show_unique' },
        },
      },
      { ...span, section: 'Details' },
      {
        key: 'tags',
        name: 'Tags',
        source: fm,
        config: tags('Workshop', 'Translation', 'Training', 'Checking', 'Publishing', 'Research'),
        section: 'Details',
      },
      {
        key: 'training_event_id',
        name: 'Training event ID',
        source: fm,
        config: { type: 'text' },
        section: 'Details',
        hide_when_empty: true,
      },
      { ...relation('okrs', '2030 OKRs', 'okr', true), section: 'Details' },
      money('field_cost', 'Field cost', 'budget'),
      money('committed', 'Committed', 'committed'),
      money('remaining_need', 'Remaining funding need', 'remaining_need'),
    ],
  },
  views: projectViews,
  templates: [
    {
      id: id(550),
      name: 'New Project',
      values: { phase: 'proposed' },
      bodyMd: '## Goal\n\n## Plan\n\n## Risks\n',
    },
  ],
};

export const okrCollection: BuiltIn = {
  id: id(6),
  definition: {
    key: 'okr',
    name: '2030 OKRs',
    jdArea: AREA,
    rowSource: 'pages',
    pageType: 'okr',
    description: 'Objectives and key results the programs and projects work toward.',
    locked: true,
    properties: [
      titleOnPage,
      { key: 'status', name: 'Status', source: fm, config: okrStatus },
      person('owner', 'Owner', false),
      {
        key: 'key_results',
        name: 'Key results',
        source: fm,
        config: { type: 'text', multiline: true },
      },
      relation('programs', 'Programs', 'program', true, 'okrs'),
      relation('projects', 'Projects', 'project', true, 'okrs'),
    ],
  },
  views: [
    {
      id: id(601),
      settings: {
        name: 'By status',
        layout: 'board',
        scope: 'shared',
        properties: shown('name', 'owner'),
        group: { property: 'status', by: 'value' },
      },
    },
  ],
};
