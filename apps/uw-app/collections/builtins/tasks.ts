import { all, column, condition, derived, either, option, shown, status, system } from './parts.ts';
import type { BuiltIn } from './seed-types.ts';

const taskStatus = {
  type: 'status',
  options: [
    status('backlog', 'Backlog', 'to_do'),
    status('recurring', 'Recurring', 'to_do'),
    status('suggested', 'Suggested', 'to_do'),
    status('open', 'To do', 'to_do'),
    status('in_progress', 'In progress', 'in_progress'),
    status('review', 'Review', 'in_progress'),
    status('done', 'Complete', 'complete'),
    status('dismissed', 'Dismissed', 'complete'),
  ],
};

const priority = {
  type: 'select',
  options: [
    option('urgent', 'Urgent', 'held'),
    option('high', 'High', 'info'),
    option('normal', 'Normal'),
    option('low', 'Low'),
  ],
};

const tags = {
  type: 'multi_select',
  options: [
    option('bug', 'Bug'),
    option('docs', 'Docs'),
    option('infra', 'Infrastructure'),
    option('meeting', 'Meeting'),
    option('research', 'Research'),
    option('security', 'Security'),
  ],
};

export const tasksCollection: BuiltIn = {
  id: 'c0110000-0000-4000-8000-000000000001',
  definition: {
    key: 'tasks',
    name: 'Tasks',
    jdArea: '00-09',
    rowSource: 'tasks',
    pageType: null,
    description: 'Every team’s tasks in one list. Each board is a saved view filtered by area.',
    locked: true,
    properties: [
      { key: 'title', name: 'Task', config: { type: 'title' }, source: column('title') },
      { key: 'status', name: 'Status', config: taskStatus, source: column('status') },
      {
        key: 'assignees',
        name: 'Assignees',
        config: { type: 'person', multiple: true },
        source: column('assignees'),
      },
      { key: 'priority', name: 'Priority', config: priority, source: column('priority') },
      { key: 'due', name: 'Due', config: { type: 'date' }, source: column('due') },
      { key: 'tags', name: 'Tags', config: tags, source: column('tags') },
      { key: 'area', name: 'Area', config: { type: 'text' }, source: column('jd_area') },
      {
        key: 'project',
        name: 'Project',
        config: { type: 'relation', relation: { target: 'project', multiple: false } },
        source: column('page_id'),
      },
      {
        key: 'related',
        name: 'Related tasks',
        config: { type: 'relation', relation: { target: 'tasks', multiple: true } },
        source: column('related'),
      },
      { key: 'source', name: 'Source', config: { type: 'text' }, source: column('source') },
      {
        key: 'description',
        name: 'Description',
        config: { type: 'text', multiline: true },
        source: column('description'),
        hide_when_empty: true,
      },
      {
        key: 'files',
        name: 'Attachments',
        config: { type: 'files' },
        source: column('files'),
        hide_when_empty: true,
      },
      { ...system('created_time', 'Created'), section: 'History' },
      { ...system('created_by', 'Created by'), section: 'History' },
      { ...system('edited_time', 'Updated'), section: 'History' },
      { ...system('completed_time', 'Closed'), section: 'History', hide_when_empty: true },
      {
        key: 'days_left',
        name: 'Days left',
        source: derived,
        config: { type: 'computed', computed: { function: 'date_until', inputs: ['due'] } },
      },
    ],
  },
  views: [
    {
      id: 'c0110000-0000-4000-8000-000000000101',
      settings: {
        name: 'My Tasks',
        layout: 'list',
        scope: 'shared',
        properties: shown('title', 'due', 'source', 'status'),
        filter: all(
          condition('assignees', 'contains', { kind: 'me' }),
          either(
            condition('status', 'group_is', 'to_do'),
            condition('status', 'group_is', 'in_progress'),
          ),
        ),
        sorts: [{ property: 'due', direction: 'asc' }],
      },
    },
    {
      id: 'c0110000-0000-4000-8000-000000000102',
      settings: {
        name: 'Infrastructure board',
        layout: 'board',
        scope: 'shared',
        properties: shown('title', 'assignees', 'priority', 'due'),
        filter: all(condition('area', 'is', '30-39')),
        sorts: [
          { property: 'priority', direction: 'asc' },
          { property: 'completed_time', direction: 'desc' },
        ],
        group: { property: 'status', by: 'value' },
        groups: [{ value: 'in_progress', visible: true, wipLimit: 5 }],
        manualOrder: true,
      },
    },
    {
      id: 'c0110000-0000-4000-8000-000000000103',
      settings: {
        name: 'All tasks',
        layout: 'table',
        scope: 'shared',
        properties: shown(
          'title',
          'status',
          'assignees',
          'priority',
          'due',
          'tags',
          'area',
          'project',
          'source',
          'created_time',
          'completed_time',
        ),
        sorts: [{ property: 'created_time', direction: 'desc' }],
      },
    },
  ],
};
