import type { Template, TemplateStage } from './types.ts';

const check: TemplateStage = {
  key: 'check',
  title: 'CI and review verdict',
  position: 10,
  bracket: 'build_package',
  agentPickup: 'allowed',
  exitGate: 'checks',
  connector: 'none',
  validators: [],
  feeds: [],
  wipLimit: 3,
};

const ship: TemplateStage = {
  key: 'ship',
  title: 'Merge',
  position: 20,
  bracket: 'deploy_package',
  agentPickup: 'none',
  exitGate: 'human_approval',
  connector: 'merge',
  validators: [],
  feeds: [],
  wipLimit: 3,
};

export const checkOnly: Template = {
  key: 'check-only',
  title: 'Review and merge only',
  stages: [check, ship],
};
