import type { Crumb, Tab } from '@uw/ui/components/top-bar.tsx';
import { pageNames } from './names.ts';
import { agentQueuesPath, queuePath, flowPath } from './paths.ts';

export function workflowCrumbs(title: string, titleHref: string, last: string): readonly Crumb[] {
  return [
    { label: pageNames.infrastructure },
    { label: pageNames.agentQueues, href: agentQueuesPath() },
    { label: title, href: titleHref },
    { label: last },
  ];
}

export function workflowTabs(harnessId: string, current: 'flow' | 'queue'): readonly Tab[] {
  return [
    { label: pageNames.queue, href: queuePath(harnessId), current: current === 'queue' },
    { label: pageNames.flow, href: flowPath(harnessId), current: current === 'flow' },
  ];
}
