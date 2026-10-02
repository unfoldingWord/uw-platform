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
        'Only test files and sim/ import the fixture seeding helpers, which write tables their owners write.',
      severity: 'error',
      from: { path: '^(apps|packages|tools)/', pathNot: testFile },
      to: { path: '^packages/db/test-seed\\.ts$' },
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
