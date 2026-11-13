import type { Tab } from '@uw/ui/components/top-bar.tsx';
import { pageNames } from './names.ts';
import { boardPath, flowPath } from './paths.ts';

export function workflowTabs(harnessId: string, current: 'flow' | 'board'): readonly Tab[] {
  return [
    { label: pageNames.board, href: boardPath(harnessId), current: current === 'board' },
    { label: pageNames.flow, href: flowPath(harnessId), current: current === 'flow' },
  ];
}
