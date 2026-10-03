const npm = (name) => `(^|node_modules/)${name}(/|$)`;
const vendorSdk = [
  npm('@anthropic-ai'),
  npm('openai'),
  npm('@openrouter'),
  '(^|node_modules/)openrouter',
];
const impure = [
  npm('hono'),
  npm('drizzle-orm'),
  npm('wrangler'),
  npm('@cloudflare'),
  '^cloudflare:',
  npm('@neondatabase'),
  npm('pg'),
  npm('postgres'),
  '^(node:)?(http|https|http2|net|tls|dns|dgram)$',
];

const harnessMayImport = '^packages/(harness|contracts|core)/';
const contractsMayImport = ['^packages/contracts/', npm('zod')];
const testFile = '\\.test\\.ts$';
const portContracts = '^packages/harness/port-contracts/';
const simMayImport = [
  '^sim/',
  '^packages/(harness|contracts|db)/',
  '^(node:)?(fs|fs/promises|path|url|process|os|assert|assert/strict|child_process)$',
];

const github = (file) => `^apps/uw-app/github/${file}\\.ts$`;
const octokitWebhookSignatures = npm('@octokit/webhooks-methods');
const appTesting = '^apps/(uw-app|uw-ingest)/(github/)?testing/';
const gateKernel = '^apps/uw-app/commands/person/gate-kernel\\.ts$';
const gateGitHub = '^apps/uw-app/commands/person/gate-github\\.ts$';
const commandCapabilities = '^apps/uw-app/commands/capabilities\\.ts$';
const readRoots = ['^apps/uw-app/queue/worker\\.ts$', gateKernel, gateGitHub];
const appConfigRoots = ['^apps/uw-app/(queue/worker|cron/github-sweep)\\.ts$', gateGitHub];

const forbidden = (name, comment, from, to) => ({
  name,
  comment,
  severity: 'error',
  from: { path: from },
  to: { path: to },
});

export default {
  forbidden: [
    {
      name: 'no-circular',
      comment: 'A circular import is a defect.',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    forbidden(
      'contracts-imports-nothing',
      'packages/contracts depends on no other workspace code.',
      '^packages/contracts/',
      '^(apps|sim|packages/(core|db|harness|ui))/',
    ),
    {
      name: 'contracts-imports-zod-only',
      comment:
        'packages/contracts imports zod and its own files and nothing else: no node, Workers or network module.',
      severity: 'error',
      from: { path: '^packages/contracts/', pathNot: testFile },
      to: { pathNot: contractsMayImport },
    },
    {
      name: 'contracts-tests-import-zod-vitest-and-fixture-reads-only',
      comment:
        'A packages/contracts test imports what contracts may, plus Vitest and node:fs and node:path to read its fixtures.',
      severity: 'error',
      from: { path: `^packages/contracts/.*${testFile}` },
      to: { pathNot: [...contractsMayImport, npm('vitest'), '^(node:)?(fs|path)$'] },
    },
    forbidden(
      'core-imports-contracts-only',
      'packages/core depends on packages/contracts and nothing else in the workspace.',
      '^packages/core/',
      '^(apps|sim|packages/(db|harness|ui))/',
    ),
    forbidden(
      'db-imports-contracts-and-core',
      'packages/db imports nothing from apps, the kernel, the sim or the ui.',
      '^packages/db/',
      '^(apps|sim|packages/(harness|ui))/',
    ),
    forbidden(
      'ui-imports-nothing',
      'packages/ui depends on no other workspace code.',
      '^packages/ui/',
      '^(apps|sim|packages/(contracts|core|db|harness))/',
    ),
    {
      name: 'harness-imports-contracts-and-core-only',
      comment: 'packages/harness imports packages/contracts and packages/core and nothing else.',
      severity: 'error',
      from: { path: '^packages/harness/', pathNot: [testFile, portContracts] },
      to: { pathNot: harnessMayImport },
    },
    {
      name: 'harness-port-contracts-import-the-harness-and-vitest-only',
      comment: 'A port contract suite imports what the harness may, plus Vitest.',
      severity: 'error',
      from: { path: portContracts },
      to: { pathNot: [harnessMayImport, npm('vitest')] },
    },
    {
      name: 'port-contracts-only-in-tests',
      comment:
        'Only test files import a port contract suite, so Vitest never enters a Worker bundle.',
      severity: 'error',
      from: { path: '^(apps|sim|packages)/', pathNot: [testFile, portContracts] },
      to: { path: portContracts },
    },
    {
      name: 'apps-never-import-the-embedded-database',
      comment:
        'Worker sources never import the embedded Postgres, so PGlite never enters a Worker bundle.',
      severity: 'error',
      from: { path: '^apps/' },
      to: { path: ['^packages/db/embedded\\.ts$', npm('@electric-sql/pglite')] },
    },
    {
      name: 'store-executor-stays-in-the-store',
      comment:
        'Only the Store and Grants gateways in packages/db/store unwrap a transaction to its Drizzle executor.',
      severity: 'error',
      from: { pathNot: '^packages/db/store/' },
      to: { path: '^packages/db/store/store\\.ts$' },
    },
    {
      name: 'test-seed-only-in-tests-and-sim',
      comment:
        'Only test files, the app test helpers and sim/ import the fixture seeding helpers, which write tables their owners write.',
      severity: 'error',
      from: { path: '^(apps|packages|tools)/', pathNot: [testFile, appTesting] },
      to: { path: '^packages/db/test-seed\\.ts$' },
    },
    {
      name: 'in-process-host-only-in-tests',
      comment:
        'Only test files connect the in-process Workflow host until the Workflow step that serves it lands.',
      severity: 'error',
      from: { pathNot: testFile },
      to: { path: '^apps/uw-app/mcp/in-process\\.ts$' },
    },
    {
      name: 'app-testing-only-in-tests',
      comment:
        'The app test helpers under testing/ write fixtures straight into tables and hold fixture keys, so only test files and other test helpers import them.',
      severity: 'error',
      from: { pathNot: [testFile, appTesting] },
      to: { path: appTesting },
    },
    {
      name: 'harness-testing-only-in-tests',
      comment:
        'The connector exit and other test-only kernel entry points are imported only by test files.',
      severity: 'error',
      from: { pathNot: testFile },
      to: { path: '^packages/harness/testing\\.ts$' },
    },
    {
      name: 'harness-tests-import-contracts-core-and-vitest-only',
      comment: 'A packages/harness test imports what the harness may, plus Vitest.',
      severity: 'error',
      from: { path: `^packages/harness/.*${testFile}` },
      to: { pathNot: [harnessMayImport, npm('vitest')] },
    },
    forbidden(
      'harness-is-pure',
      'packages/harness imports nothing from Workers, Drizzle, a vendor SDK or the network.',
      '^packages/harness/',
      [...impure, ...vendorSdk],
    ),
    forbidden(
      'sim-imports-harness-contracts-and-db-only',
      'sim imports packages/harness, packages/contracts and packages/db and nothing else in the workspace.',
      '^sim/',
      '^(apps|packages/(core|ui))/',
    ),
    {
      name: 'sim-imports-harness-contracts-db-and-node-only',
      comment:
        'sim imports packages/harness, packages/contracts, packages/db, its own files and Node built-ins; its tests also Vitest.',
      severity: 'error',
      from: { path: '^sim/' },
      to: { pathNot: [...simMayImport, npm('vitest')] },
    },
    {
      name: 'sim-os-and-child-process-only-in-tests-cli-and-runner',
      comment:
        'Only sim tests, sim/cli and sim/runner reach the host through node:os or node:child_process.',
      severity: 'error',
      from: { path: '^sim/', pathNot: [testFile, '^sim/(cli|runner)/'] },
      to: { path: '^(node:)?(os|child_process)$' },
    },
    {
      name: 'sim-non-test-files-never-import-vitest',
      comment: 'Only sim tests import Vitest.',
      severity: 'error',
      from: { path: '^sim/', pathNot: testFile },
      to: { path: npm('vitest') },
    },
    forbidden(
      'ingest-never-touches-the-kernel',
      'apps/uw-ingest verifies webhooks and enqueues; it never imports the kernel.',
      '^apps/uw-ingest/',
      '^packages/harness/',
    ),
    forbidden(
      'islands-never-call-the-kernel',
      'Islands call the command API, never the kernel.',
      '^apps/uw-app/islands/',
      '^packages/harness/',
    ),
    {
      name: 'github-reads-only-in-github-and-composition-roots',
      comment:
        'The read-only GitHub client and its transport are imported only under apps/uw-app/github, by the queue root, and by the person gate kernel and its GitHub opener.',
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
        'Only the read client, the comment writer and the ship writes open a GitHub session.',
      severity: 'error',
      from: { pathNot: [github('(client|comments|ship-writes)'), testFile] },
      to: { path: github('session') },
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
    {
      name: 'gate-kernel-only-in-gate-commands',
      comment:
        'Only the command capabilities build the kernel that holds the GitHub reader and the ship writes, and they hand it only to a person on a gate command.',
      severity: 'error',
      from: { pathNot: [commandCapabilities, testFile] },
      to: { path: gateKernel },
    },
    {
      name: 'gate-kernel-only-in-gate-commands',
      comment: 'Only the person deps open the gate GitHub, for the gate commands.',
      severity: 'error',
      from: { pathNot: ['^apps/uw-app/commands/person-deps\\.ts$', testFile] },
      to: { path: gateGitHub },
    },
    {
      name: 'gate-kernel-only-in-gate-commands',
      comment:
        'The person deps open the gate GitHub for the gate commands and never build the gate kernel.',
      severity: 'error',
      from: { path: '^apps/uw-app/commands/person-deps\\.ts$' },
      to: { path: gateKernel },
    },
    {
      name: 'person-deps-only-in-app-and-routes',
      comment:
        'The person deps hold the gate GitHub opener, so only the app, the command routes, the app test helpers and tests import them.',
      severity: 'error',
      from: {
        pathNot: [
          '^apps/uw-app/app\\.tsx$',
          '^apps/uw-app/commands/routes\\.ts$',
          appTesting,
          testFile,
        ],
      },
      to: { path: '^apps/uw-app/commands/person-deps\\.ts$' },
    },
    {
      name: 'person-surface-only-from-commands',
      comment:
        'The person surface is imported only from apps/uw-app/commands/, the app test helpers and tests.',
      severity: 'error',
      from: { pathNot: ['^apps/uw-app/commands/', appTesting, testFile] },
      to: { path: '^apps/uw-app/commands/person/' },
    },
    forbidden(
      'agent-hosts-never-import-commands',
      'Nothing an agent, a model process or the queue reaches imports the command API, so none of them reaches the gate kernel.',
      '^apps/uw-app/(mcp|engines|queue)/',
      '^apps/uw-app/commands/',
    ),
    {
      name: 'agent-hosts-never-import-commands',
      comment:
        'The cron imports nothing of the command API but the request ledger, whose old rows it prunes, so it never reaches the gate kernel.',
      severity: 'error',
      from: { path: '^apps/uw-app/cron/' },
      to: { path: '^apps/uw-app/commands/', pathNot: '^apps/uw-app/commands/requests\\.ts$' },
    },
    forbidden(
      'github-never-in-mcp-or-engines',
      'Nothing an agent or a model process reaches imports the GitHub client, so no token reaches either.',
      '^apps/uw-app/(mcp|engines)/',
      '^apps/uw-app/github/',
    ),
    {
      name: 'vendor-sdk-only-in-engines',
      comment: 'A vendor SDK is imported only inside apps/uw-app/engines/<engine>/.',
      severity: 'error',
      from: { path: '^(apps|packages|sim|tests)/', pathNot: '^apps/uw-app/engines/[^/]+/' },
      to: { path: vendorSdk },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '/dist/' },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      mainFields: ['module', 'main', 'types'],
    },
  },
};
