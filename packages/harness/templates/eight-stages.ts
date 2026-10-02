import type { Connector } from '@uw/contracts';
import type { Template, TemplateStage } from '../template-property.ts';

type Titles = readonly [string, string, string, string, string, string, string, string];

type Row = {
  readonly key: string;
  readonly bracket: TemplateStage['bracket'];
  readonly agentPickup: TemplateStage['agentPickup'];
  readonly exitGate: TemplateStage['exitGate'];
  readonly validators: readonly string[];
  readonly feeds: readonly string[];
};

const base = { agentPickup: 'allowed', exitGate: 'checks', validators: [], feeds: [] } as const;

const rows: readonly Row[] = [
  { ...base, key: 'package', bracket: 'product_package', agentPickup: 'none', exitGate: 'none' },
  { ...base, key: 'scope', bracket: 'build_package' },
  { ...base, key: 'plan', bracket: 'build_package' },
  { ...base, key: 'build', bracket: 'build_package' },
  { ...base, key: 'check', bracket: 'build_package' },
  {
    ...base,
    key: 'ship',
    bracket: 'deploy_package',
    agentPickup: 'none',
    exitGate: 'human_approval',
  },
  { ...base, key: 'validate', bracket: 'iterate', feeds: ['package'] },
  {
    ...base,
    key: 'close',
    bracket: 'iterate',
    validators: ['learning_attached'],
    feeds: ['scope'],
  },
];

export function eightStages(
  key: string,
  title: string,
  titles: Titles,
  shipConnector: Connector,
): Template {
  return {
    key,
    title,
    stages: rows.map((row, index) => ({
      ...row,
      title: titles.at(index) ?? row.key,
      position: (index + 1) * 10,
      connector: row.key === 'ship' ? shipConnector : 'none',
      wipLimit: 3,
    })),
  };
}
