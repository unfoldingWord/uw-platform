import {
  npm,
  vendorSdk,
  impure,
  harnessMayImport,
  contractsMayImport,
  testFile,
  portContracts,
  simMayImport,
  appTesting,
  forbidden,
} from './shared.mjs';

export const layerRules = [
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
    comment:
      'packages/harness imports packages/contracts, packages/core and yaml (the agentskills header parser) and nothing else.',
    severity: 'error',
    from: { path: '^packages/harness/', pathNot: [testFile, portContracts] },
    to: { pathNot: harnessMayImport },
  },
  {
    name: 'harness-port-contracts-import-the-harness-and-vitest-only',
    comment: 'A port contract suite imports what the harness may, plus Vitest.',
    severity: 'error',
    from: { path: portContracts },
    to: { pathNot: [...harnessMayImport, npm('vitest')] },
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
    name: 'harness-tests-import-contracts-core-and-vitest-only',
    comment: 'A packages/harness test imports what the harness may, plus Vitest.',
    severity: 'error',
    from: { path: `^packages/harness/.*${testFile}` },
    to: { pathNot: [...harnessMayImport, npm('vitest')] },
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
    'Islands call the command API, never the kernel, the database or a server module.',
    '^apps/uw-app/islands/',
    '^(?:packages/harness/|packages/db/|apps/uw-app/(?!islands/))',
  ),
  {
    name: 'islands-bundle-only-in-assets-and-views',
    comment: 'The built islands bundle is served by the asset routes and named by the screens.',
    severity: 'error',
    from: { pathNot: ['^apps/uw-app/(?:assets|views)/', testFile] },
    to: { path: '^apps/uw-app/generated/islands\\.ts$' },
  },
];
