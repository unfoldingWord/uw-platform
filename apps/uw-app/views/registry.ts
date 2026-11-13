export type ScreenEntry = { readonly name: string; readonly file: string; readonly path: string };

export const screens: readonly ScreenEntry[] = [
  { name: 'home', file: 'apps/uw-app/views/screens/home.tsx', path: '/' },
  {
    name: 'agent-queues',
    file: 'apps/uw-app/views/screens/agent-queues.tsx',
    path: '/agent-queues',
  },
  { name: 'flow', file: 'apps/uw-app/views/screens/flow.tsx', path: '/harnesses/:harnessId' },
  {
    name: 'queue',
    file: 'apps/uw-app/views/screens/queue.tsx',
    path: '/harnesses/:harnessId/queue',
  },
  { name: 'gates', file: 'apps/uw-app/views/screens/gates.tsx', path: '/gates' },
  {
    name: 'gate',
    file: 'apps/uw-app/views/screens/gate.tsx',
    path: '/harnesses/:harnessId/gates/:itemId',
  },
  {
    name: 'play',
    file: 'apps/uw-app/views/screens/play.tsx',
    path: '/harnesses/:harnessId/items/:itemId',
  },
  { name: 'persona', file: 'apps/uw-app/views/screens/persona.tsx', path: '/personas/:pageId' },
  { name: 'health', file: 'apps/uw-app/views/screens/health.tsx', path: '/health' },
  {
    name: 'health-list',
    file: 'apps/uw-app/views/screens/health-list.tsx',
    path: '/health/:indicator',
  },
  {
    name: 'not-found',
    file: 'apps/uw-app/views/screens/not-found.tsx',
    path: '/harnesses/00000000-0000-4000-8000-000000000000',
  },
];
