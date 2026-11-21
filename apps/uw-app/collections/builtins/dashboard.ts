import type { SeededHome } from '../../pages/area-homes.ts';

const view = (key: string, n: number, name: string) =>
  `![${name}](/collections/${key}/views/c0110000-0000-4000-8000-${String(n).padStart(12, '0')})`;

export const dashboardHome: SeededHome = {
  area: '00-09',
  pageId: 'c0110000-0000-4000-8000-000000000900',
  category: '00',
  slug: 'dashboard',
  title: '00 Dashboard',
  overview: 'The strategic cascade at a glance, as live views beside the words that explain them.',
  bodyMd: [
    'This page gathers the work of the strategic cascade in one place. Each view below is live: it shows only the rows you may read, and changes as the work changes.',
    '',
    '## Programs',
    '',
    'Programs are the budget plan’s cascade nodes. Their money is read from the budget and changed only there.',
    '',
    view('program', 404, 'Programs by phase'),
    '',
    view('program', 401, 'Programs by phase, as a board'),
    '',
    '## Projects',
    '',
    view('project', 508, 'Projects underway'),
    '',
    '## Your tasks',
    '',
    view('tasks', 101, 'My Tasks'),
    '',
  ].join('\n'),
};
