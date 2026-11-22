import { DIRECTORY_AREA } from '@uw/core/acl';
import { column, option, shown } from './parts.ts';
import type { BuiltIn } from './seed-types.ts';

const people = { steward: '10-19', role: 'viewer', owner: true } as const;

const team = {
  type: 'select',
  options: [
    option('leadership', 'Leadership'),
    option('finance', 'Finance'),
    option('people', 'People & HR'),
    option('operations', 'Operations'),
    option('field', 'Field programs'),
    option('technology', 'Technology'),
    option('benefactors', 'Engage benefactors'),
    option('strategy', 'Innovation & strategy'),
    option('content', 'Content'),
    option('communications', 'Communications'),
    option('catalyzation', 'Catalyzation'),
  ],
};

const employment = {
  type: 'select',
  options: [
    option('full_time', 'Full time'),
    option('part_time', 'Part time'),
    option('contractor', 'Contractor'),
    option('volunteer', 'Volunteer'),
    option('intern', 'Intern'),
  ],
};

const ring = {
  type: 'select',
  options: [option('core', 'Core'), option('extended', 'Extended'), option('partner', 'Partner')],
};

const compliance = {
  type: 'select',
  options: [
    option('current', 'Current', 'success'),
    option('due', 'Due soon', 'info'),
    option('overdue', 'Overdue', 'held'),
  ],
};

const restricted = (key: string, name: string, config: unknown, columnName: string) => ({
  key,
  name,
  config,
  source: column(columnName),
  classification: 'restricted',
  rule: people,
  section: 'Private',
  hide_when_empty: true,
});

export const directoryCollection: BuiltIn = {
  id: 'c0110000-0000-4000-8000-000000000002',
  definition: {
    key: 'directory',
    name: 'Colleague Directory',
    jdArea: DIRECTORY_AREA,
    rowSource: 'people',
    pageType: null,
    description: 'Everyone who works with unfoldingWord. A person’s row is their profile.',
    locked: true,
    properties: [
      { key: 'name', name: 'Name', config: { type: 'title' }, source: column('display_name') },
      { key: 'role', name: 'Role', config: { type: 'text' }, source: column('role') },
      { key: 'team', name: 'Team', config: team, source: column('team') },
      { key: 'employment', name: 'Employment', config: employment, source: column('employment') },
      { key: 'ring', name: 'Ring', config: ring, source: column('ring') },
      { key: 'joined', name: 'Joined', config: { type: 'date' }, source: column('joined') },
      {
        key: 'email',
        name: 'Email',
        config: { type: 'email' },
        source: column('email'),
        section: 'Contact',
      },
      {
        key: 'url',
        name: 'Website',
        config: { type: 'url' },
        source: column('url'),
        section: 'Contact',
        hide_when_empty: true,
      },
      restricted('phone', 'Phone', { type: 'phone' }, 'phone'),
      restricted(
        'mailing_address',
        'Mailing address',
        { type: 'text', multiline: true },
        'mailing_address',
      ),
      restricted('compliance_status', 'Compliance', compliance, 'compliance_status'),
      restricted('compliance_due', 'Compliance due', { type: 'date' }, 'compliance_due'),
      {
        key: 'portfolios',
        name: 'Portfolios',
        config: { type: 'relation', relation: { target: 'portfolio', multiple: true } },
        source: column('portfolios'),
        hide_when_empty: true,
      },
    ],
  },
  views: [
    {
      id: 'c0110000-0000-4000-8000-000000000201',
      settings: {
        name: 'Everyone',
        layout: 'gallery',
        scope: 'shared',
        properties: shown('name', 'role', 'team'),
        sorts: [{ property: 'name', direction: 'asc' }],
      },
    },
    {
      id: 'c0110000-0000-4000-8000-000000000202',
      settings: {
        name: 'By team',
        layout: 'gallery',
        scope: 'shared',
        properties: shown('name', 'role'),
        sorts: [{ property: 'name', direction: 'asc' }],
        group: { property: 'team', by: 'value' },
        hideEmptyGroups: true,
      },
    },
    {
      id: 'c0110000-0000-4000-8000-000000000203',
      settings: {
        name: 'Table',
        layout: 'table',
        scope: 'shared',
        properties: shown('name', 'role', 'team', 'employment', 'joined', 'email'),
        sorts: [{ property: 'name', direction: 'asc' }],
      },
    },
    {
      id: 'c0110000-0000-4000-8000-000000000204',
      settings: {
        name: 'By employment',
        layout: 'chart',
        scope: 'shared',
        group: { property: 'employment', by: 'value' },
        chart: { kind: 'donut', sum: null },
      },
    },
    {
      id: 'c0110000-0000-4000-8000-000000000205',
      settings: {
        name: 'Compliance',
        layout: 'chart',
        scope: 'shared',
        group: { property: 'compliance_status', by: 'value' },
        chart: { kind: 'donut', sum: null },
      },
    },
  ],
  templates: [],
};
