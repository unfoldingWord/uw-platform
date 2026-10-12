import type { Connector } from '@uw/contracts';
import type { Template, TemplateStage } from './types.ts';

type Titles = readonly [string, string, string, string, string, string, string, string];

type Row = {
  readonly key: string;
  readonly title: string;
  readonly bracket: TemplateStage['bracket'];
  readonly agentPickup: TemplateStage['agentPickup'];
  readonly exitGate: TemplateStage['exitGate'];
  readonly validators: readonly string[];
  readonly feeds: readonly string[];
};

const base = { agentPickup: 'allowed', exitGate: 'checks', validators: [], feeds: [] } as const;

function rowsFor(titles: Titles): readonly Row[] {
  const [packageTitle, scope, plan, build, check, ship, validate, close] = titles;
  return [
    {
      ...base,
      key: 'package',
      title: packageTitle,
      bracket: 'product_package',
      agentPickup: 'none',
      exitGate: 'none',
    },
    { ...base, key: 'scope', title: scope, bracket: 'build_package' },
    { ...base, key: 'plan', title: plan, bracket: 'build_package' },
    { ...base, key: 'build', title: build, bracket: 'build_package' },
    { ...base, key: 'check', title: check, bracket: 'build_package' },
    {
      ...base,
      key: 'ship',
      title: ship,
      bracket: 'deploy_package',
      agentPickup: 'none',
      exitGate: 'human_approval',
    },
    { ...base, key: 'validate', title: validate, bracket: 'iterate', feeds: ['package'] },
    {
      ...base,
      key: 'close',
      title: close,
      bracket: 'iterate',
      validators: ['learning_attached'],
      feeds: ['scope'],
    },
  ];
}

export function eightStages(
  key: string,
  title: string,
  titles: Titles,
  shipConnector: Connector,
): Template {
  return {
    key,
    title,
    stages: rowsFor(titles).map((row, index) => ({
      ...row,
      position: (index + 1) * 10,
      connector: row.key === 'ship' ? shipConnector : 'none',
      wipLimit: 3,
    })),
  };
}
