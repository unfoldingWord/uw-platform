export type ScreenEntry = { readonly name: string; readonly file: string; readonly path: string };

export const screens: readonly ScreenEntry[] = [
  { name: 'home', file: 'apps/uw-platform/views/screens/home.tsx', path: '/' },
  {
    name: 'agent-queues',
    file: 'apps/uw-platform/views/screens/agent-queues.tsx',
    path: '/agent-queues',
  },
  {
    name: 'new-workflow',
    file: 'apps/uw-platform/views/screens/new-workflow.tsx',
    path: '/agent-queues/new',
  },
  { name: 'flow', file: 'apps/uw-platform/views/screens/flow.tsx', path: '/harnesses/:harnessId' },
  {
    name: 'queue',
    file: 'apps/uw-platform/views/screens/queue.tsx',
    path: '/harnesses/:harnessId/queue',
  },
  {
    name: 'waiting',
    file: 'apps/uw-platform/views/screens/waiting.tsx',
    path: '/harnesses/:harnessId/waiting',
  },
  {
    name: 'runs',
    file: 'apps/uw-platform/views/screens/runs.tsx',
    path: '/harnesses/:harnessId/runs',
  },
  {
    name: 'run',
    file: 'apps/uw-platform/views/screens/run.tsx',
    path: '/harnesses/:harnessId/runs/:runId',
  },
  {
    name: 'controls',
    file: 'apps/uw-platform/views/screens/controls.tsx',
    path: '/harnesses/:harnessId/controls',
  },
  {
    name: 'agents',
    file: 'apps/uw-platform/views/screens/agents.tsx',
    path: '/harnesses/:harnessId/agents',
  },
  {
    name: 'new-agent',
    file: 'apps/uw-platform/views/screens/new-agent.tsx',
    path: '/harnesses/:harnessId/agents/new',
  },
  {
    name: 'gate',
    file: 'apps/uw-platform/views/screens/gate.tsx',
    path: '/harnesses/:harnessId/gates/:itemId',
  },
  {
    name: 'play',
    file: 'apps/uw-platform/views/screens/play.tsx',
    path: '/harnesses/:harnessId/items/:itemId',
  },
  { name: 'page', file: 'apps/uw-platform/views/screens/page.tsx', path: '/pages/:pageId' },
  {
    name: 'page-edit',
    file: 'apps/uw-platform/views/screens/page-edit.tsx',
    path: '/pages/:pageId/edit',
  },
  {
    name: 'persona',
    file: 'apps/uw-platform/views/screens/persona.tsx',
    path: '/personas/:pageId',
  },
  { name: 'health', file: 'apps/uw-platform/views/screens/health.tsx', path: '/health' },
  {
    name: 'health-list',
    file: 'apps/uw-platform/views/screens/health-list.tsx',
    path: '/health/:indicator',
  },
  { name: 'access', file: 'apps/uw-platform/views/screens/access.tsx', path: '/access' },
  { name: 'search', file: 'apps/uw-platform/views/screens/search.tsx', path: '/search' },
  { name: 'wiki', file: 'apps/uw-platform/views/screens/wiki.tsx', path: '/wiki' },
  {
    name: 'wiki-category',
    file: 'apps/uw-platform/views/screens/wiki-category.tsx',
    path: '/wiki/:category',
  },
  {
    name: 'wiki-review',
    file: 'apps/uw-platform/views/screens/wiki-review.tsx',
    path: '/wiki/review',
  },
  {
    name: 'page-comments',
    file: 'apps/uw-platform/views/screens/page-comments.tsx',
    path: '/pages/:pageId/comments',
  },
  {
    name: 'wiki-area',
    file: 'apps/uw-platform/views/screens/wiki-area.tsx',
    path: '/wiki/areas/:area',
  },
  { name: 'wiki-new', file: 'apps/uw-platform/views/screens/wiki-new.tsx', path: '/wiki/new' },
  {
    name: 'page-manage',
    file: 'apps/uw-platform/views/screens/page-manage.tsx',
    path: '/pages/:pageId/manage',
  },
  {
    name: 'page-version',
    file: 'apps/uw-platform/views/screens/page-version.tsx',
    path: '/pages/:pageId/versions/:version',
  },
  {
    name: 'page-suggestion',
    file: 'apps/uw-platform/views/screens/page-suggestion.tsx',
    path: '/pages/:pageId/suggestions/:suggestionId',
  },
  {
    name: 'wiki-policies',
    file: 'apps/uw-platform/views/screens/wiki-policies.tsx',
    path: '/wiki/policies',
  },
  {
    name: 'credentials',
    file: 'apps/uw-platform/views/screens/credentials.tsx',
    path: '/credentials',
  },
  { name: 'crosswalk', file: 'apps/uw-platform/views/screens/crosswalk.tsx', path: '/crosswalk' },
  {
    name: 'crosswalk-cell',
    file: 'apps/uw-platform/views/screens/crosswalk-cell.tsx',
    path: '/crosswalk/areas/:area/:tier',
  },
  {
    name: 'crosswalk-node',
    file: 'apps/uw-platform/views/screens/crosswalk-node.tsx',
    path: '/crosswalk/nodes/:nodeId',
  },

  {
    name: 'credential',
    file: 'apps/uw-platform/views/screens/credential.tsx',
    path: '/credentials/:credentialId',
  },
  {
    name: 'collections',
    file: 'apps/uw-platform/views/screens/collections.tsx',
    path: '/collections',
  },
  {
    name: 'collection',
    file: 'apps/uw-platform/views/screens/collection.tsx',
    path: '/collections/:key/views/:viewId',
  },
  {
    name: 'collection-row',
    file: 'apps/uw-platform/views/screens/collection-row.tsx',
    path: '/collections/:key/rows/:rowId',
  },
  {
    name: 'collection-settings',
    file: 'apps/uw-platform/views/screens/collection-settings.tsx',
    path: '/collections/:key/settings',
  },
  {
    name: 'export',
    file: 'apps/uw-platform/views/screens/export.tsx',
    path: '/exports/:exportId',
  },
  {
    name: 'assistant',
    file: 'apps/uw-platform/views/screens/assistant.tsx',
    path: '/assistant',
  },
  {
    name: 'not-found',
    file: 'apps/uw-platform/views/screens/not-found.tsx',
    path: '/harnesses/00000000-0000-4000-8000-000000000000',
  },
];
