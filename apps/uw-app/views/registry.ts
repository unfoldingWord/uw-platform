export type ScreenEntry = { readonly name: string; readonly file: string; readonly path: string };

export const screens: readonly ScreenEntry[] = [
  { name: 'home', file: 'apps/uw-app/views/screens/home.tsx', path: '/' },
  { name: 'flow', file: 'apps/uw-app/views/screens/flow.tsx', path: '/harnesses/:harnessId' },
  {
    name: 'board',
    file: 'apps/uw-app/views/screens/board.tsx',
    path: '/harnesses/:harnessId/board',
  },
  {
    name: 'not-found',
    file: 'apps/uw-app/views/screens/not-found.tsx',
    path: '/harnesses/00000000-0000-4000-8000-000000000000',
  },
];
