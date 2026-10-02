import type { Template, TemplateStage } from '../../template-property.ts';
import { software } from '../software.ts';

const hotfix: TemplateStage = {
  key: 'hotfix',
  title: 'Hotfix',
  position: 65,
  bracket: 'deploy_package',
  agentPickup: 'allowed',
  exitGate: 'checks',
  connector: 'merge',
  validators: [],
  feeds: [],
  wipLimit: 3,
};

export const bypassesShip: Template = {
  key: 'bypasses-ship',
  title: 'Software delivery with a hotfix around Ship',
  stages: [
    ...software.stages.map((stage) =>
      stage.key === 'build' ? { ...stage, feeds: ['hotfix'] } : stage,
    ),
    hotfix,
  ],
};
