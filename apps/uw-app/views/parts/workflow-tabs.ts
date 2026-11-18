import type { Crumb, Tab } from '@uw/ui/components/top-bar.tsx';
import { pageNames } from './names.ts';
import {
  agentQueuesPath,
  agentsPath,
  controlsPath,
  flowPath,
  queuePath,
  runsPath,
  waitingPath,
} from './paths.ts';

export type WorkflowTab = 'queue' | 'waiting' | 'runs' | 'flow' | 'controls' | 'agents';

export function workflowCrumbs(title: string, titleHref: string, last: string): readonly Crumb[] {
  return [
    { label: pageNames.infrastructure },
    { label: pageNames.agentQueues, href: agentQueuesPath() },
    { label: title, href: titleHref },
    { label: last },
  ];
}

export function workflowTabs(
  harnessId: string,
  current: WorkflowTab,
  waiting: number,
): readonly Tab[] {
  return [
    { label: pageNames.queue, href: queuePath(harnessId), current: current === 'queue' },
    {
      label: pageNames.waiting,
      href: waitingPath(harnessId),
      current: current === 'waiting',
      count: waiting,
    },
    { label: pageNames.runs, href: runsPath(harnessId), current: current === 'runs' },
    { label: pageNames.flow, href: flowPath(harnessId), current: current === 'flow' },
    {
      label: pageNames.controls,
      href: controlsPath(harnessId),
      current: current === 'controls',
    },
    { label: pageNames.agents, href: agentsPath(harnessId), current: current === 'agents' },
  ];
}
