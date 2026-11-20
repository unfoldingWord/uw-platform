import type { IconName } from '@uw/ui/generated/icons';

export const pageNames = {
  home: 'Today',
  waiting: 'Waiting On You',
  agentQueues: 'Agent Queues',
  newWorkflow: 'New Workflow',
  infrastructure: 'Infrastructure',
  health: 'Health',
  notFound: 'Not Found',
  waitingApproval: 'Waiting For Approval',
  accessDeclined: 'Access Declined',
  access: 'Access',
  queue: 'Queue',
  flow: 'Flow',
  controls: 'Stages & Controls',
  agents: 'Agents',
  runs: 'Runs',
  run: 'Run',
  newAgent: 'New Agent',
  gate: 'Gate',
  item: 'Item',
  page: 'Page',
  wiki: 'Pages & Wiki',
  pageEdit: 'Edit',
  logOut: 'Log Out',
} as const;

const smallWord = /^[a-z]/;

export function titleCased(text: string): string {
  return text
    .split(' ')
    .map((word) =>
      smallWord.test(word) ? `${word[0]?.toUpperCase() ?? ''}${word.slice(1)}` : word,
    )
    .join(' ');
}

export function isTitleCase(text: string): boolean {
  return text.split(' ').every((word) => word === 'unfoldingWord' || !smallWord.test(word));
}

export type PlatformModule = {
  readonly label: string;
  readonly icon: IconName;
  readonly built?: BuiltModule;
};
export type BuiltModule = 'today' | 'health' | 'agentQueues' | 'access' | 'pages';
export type PlatformArea = {
  readonly code: string;
  readonly name: string;
  readonly modules: readonly PlatformModule[];
};

export const platformAreas: readonly PlatformArea[] = [
  {
    code: '00-09',
    name: 'unfoldingWord Home',
    modules: [
      { label: 'Today', icon: 'house', built: 'today' },
      { label: 'Pages & Wiki', icon: 'file-lines', built: 'pages' },
      { label: 'Strategic Cascade', icon: 'layer-group' },
      { label: 'Meetings', icon: 'calendar' },
      { label: 'JD Crosswalk', icon: 'table-cells' },
    ],
  },
  {
    code: '10-19',
    name: 'Internal Operations & Administration',
    modules: [{ label: 'Directory & Access', icon: 'users' }],
  },
  {
    code: '20-29',
    name: 'Finance',
    modules: [
      { label: 'Ledger', icon: 'scale-balanced' },
      { label: 'Budgets & Charts', icon: 'chart-column' },
      { label: 'Contracts & MOUs', icon: 'file-signature' },
      { label: 'Expenses', icon: 'receipt' },
      { label: 'Compliance', icon: 'shield-halved' },
    ],
  },
  {
    code: '30-39',
    name: 'Infrastructure',
    modules: [
      { label: 'Health', icon: 'wave-pulse', built: 'health' },
      { label: 'Agent Queues', icon: 'robot', built: 'agentQueues' },
      { label: 'Access', icon: 'lock', built: 'access' },
      { label: 'Modules', icon: 'cube' },
      { label: 'Desktop & Offline', icon: 'desktop' },
    ],
  },
  {
    code: '40-49',
    name: 'Engage Benefactors',
    modules: [
      { label: 'CRM & Giving', icon: 'heart' },
      { label: 'Grants', icon: 'award' },
      { label: 'Story Bank', icon: 'book-open' },
    ],
  },
  {
    code: '50-59',
    name: 'Innovation & Strategy',
    modules: [{ label: 'Impact Models', icon: 'bullseye' }],
  },
  { code: '60-79', name: 'Field Programs', modules: [{ label: 'Engagements', icon: 'globe' }] },
  {
    code: '80-89',
    name: 'Tech & SLR',
    modules: [
      { label: 'Products', icon: 'cubes' },
      { label: 'Development', icon: 'code-branch' },
    ],
  },
  { code: '90-99', name: 'Catalyzation', modules: [] },
];

export const moduleCodes: Readonly<Record<BuiltModule, string>> = {
  today: '00',
  health: '38',
  agentQueues: '32',
  access: '37',
  pages: '01',
};

export const noModules = 'No modules enabled for this area';

const DECADES = 10;

function decadeOf(code: string): readonly [number, number] {
  const [from = '', to = ''] = code.split('-');
  return [Number(from), Number(to)];
}

export function areaLabel(area: string): string {
  const [from] = decadeOf(area);
  const named = platformAreas.find((platform) => {
    const [start, end] = decadeOf(platform.code);
    return from >= start && from <= end;
  });
  return named === undefined ? area : `${area} ${named.name}`;
}

export function everyArea(): readonly string[] {
  return Array.from({ length: DECADES }, (_, decade) => `${decade}0-${decade}9`);
}

export function areasWithin(code: string): readonly string[] {
  const [from, to] = decadeOf(code);
  return everyArea().filter((area) => {
    const [start] = decadeOf(area);
    return start >= from && start <= to;
  });
}
