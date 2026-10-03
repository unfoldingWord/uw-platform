import {
  npm,
  testFile,
  github,
  octokitWebhookSignatures,
  appTesting,
  gateKernel,
  commandCapabilities,
  runHostDeps,
  readRoots,
  appConfigRoots,
  forbidden,
} from './shared.mjs';

export const githubRules = [
  {
    name: 'github-reads-only-in-github-and-composition-roots',
    comment:
      'The read-only GitHub client and its transport are imported only under apps/uw-app/github, by the queue root, by the person gate kernel and its GitHub opener, and by the run host deps.',
    severity: 'error',
    from: { pathNot: ['^apps/uw-app/github/', ...readRoots, testFile] },
    to: { path: github('(client|transport)') },
  },
  {
    name: 'github-app-config-only-in-github-and-composition-roots',
    comment:
      'The GitHub App configuration is read only under apps/uw-app/github, by the queue and cron sweep roots, and by the person gate GitHub opener.',
    severity: 'error',
    from: { pathNot: ['^apps/uw-app/github/', ...appConfigRoots, testFile] },
    to: { path: github('app-config') },
  },
  {
    name: 'github-session-only-in-the-github-clients',
    comment:
      'Only the read client and its diff read, the comment writer, the ship writes and the Reviewer review writes open a GitHub session.',
    severity: 'error',
    from: { pathNot: [github('(client|diff|comments|ship-writes|review-writes)'), testFile] },
    to: { path: github('session') },
  },
  {
    name: 'review-writes-only-in-the-connectors-adapter',
    comment:
      'The Reviewer review writes are built only by the platform connectors adapter, which posts only for a kernel wired with the Reviewer Apps (the run host).',
    severity: 'error',
    from: { pathNot: ['^apps/uw-app/ports/connectors\\.ts$', testFile] },
    to: { path: github('review-writes') },
  },
  {
    name: 'reviewer-apps-only-in-the-run-host',
    comment: 'Only the run host reads the Reviewer App configuration.',
    severity: 'error',
    from: { pathNot: [runHostDeps, testFile] },
    to: { path: github('reviewer-apps') },
  },
  {
    name: 'github-token-and-octokit-only-in-the-session',
    comment:
      'Only the session mints an installation token or reaches any Octokit package but the webhook signature check, so no other module holds a token.',
    severity: 'error',
    from: { pathNot: [github('session'), testFile] },
    to: { path: [github('token'), npm('@octokit')], pathNot: octokitWebhookSignatures },
  },
  {
    name: 'octokit-webhooks-methods-only-in-ingest',
    comment:
      'The one Octokit package outside the session is the webhook signature check, and only uw-ingest imports it.',
    severity: 'error',
    from: { pathNot: ['^apps/uw-ingest/', testFile] },
    to: { path: octokitWebhookSignatures },
  },
  {
    name: 'github-merge-writes-only-in-merge',
    comment:
      'The merge and the tag are written only by the merge connector in apps/uw-app/github/merge.ts; the queue and cron roots hold a read-only client.',
    severity: 'error',
    from: { pathNot: [github('merge'), testFile] },
    to: { path: github('ship-writes') },
  },
  {
    name: 'merge-handler-only-in-the-connectors-adapter',
    comment:
      'The merge connector is built only by the platform connectors adapter, so a merge runs only through the connectors port from the kernel stage exit.',
    severity: 'error',
    from: { pathNot: ['^apps/uw-app/ports/connectors\\.ts$', appTesting, testFile] },
    to: { path: github('merge') },
  },
  {
    name: 'github-comments-only-in-github',
    comment: 'The cross-reference comment is written only from apps/uw-app/github.',
    severity: 'error',
    from: { pathNot: ['^apps/uw-app/github/', testFile] },
    to: { path: github('comments') },
  },
  {
    name: 'github-module-only-in-ports-and-roots',
    comment:
      'Only the platform adapters, the queue root, the cron sweep root, the kernel composition root (for the read-client type) and the person gate kernel import apps/uw-app/github, so no other module reaches the read client, the comment writer or the sweep.',
    severity: 'error',
    from: {
      pathNot: [
        '^apps/uw-app/github/',
        '^apps/uw-app/ports/',
        '^apps/uw-app/kernel\\.ts$',
        gateKernel,
        commandCapabilities,
        ...appConfigRoots,
        appTesting,
        testFile,
      ],
    },
    to: { path: '^apps/uw-app/github/' },
  },
  {
    name: 'import-command-only-on-the-import-path',
    comment:
      'The command capabilities read issues from the read model and import them through the import path for the person import command; they reach nothing else under apps/uw-app/github.',
    severity: 'error',
    from: { path: commandCapabilities },
    to: { path: '^apps/uw-app/github/', pathNot: [github('import'), github('facts/queries')] },
  },
  forbidden(
    'github-never-in-mcp-or-engines',
    'Nothing an agent or a model process reaches imports the GitHub client, so no token reaches either.',
    '^apps/uw-app/(mcp|engines)/',
    '^apps/uw-app/github/',
  ),
];
