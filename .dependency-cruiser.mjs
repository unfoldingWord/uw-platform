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
const testFile = '\\.test\\.ts$';

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
    forbidden(
      'core-imports-contracts-only',
      'packages/core depends on packages/contracts and nothing else in the workspace.',
      '^packages/core/',
      '^(apps|sim|packages/(db|harness|ui))/',
    ),
    forbidden(
      'db-imports-contracts-and-core',
      'packages/db imports nothing from apps, the engine, the sim or the ui.',
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
      from: { path: '^packages/harness/', pathNot: testFile },
      to: { pathNot: harnessMayImport },
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
      'sim-imports-harness-and-contracts-only',
      'sim imports packages/harness and packages/contracts and nothing else in the workspace.',
      '^sim/',
      '^(apps|packages/(core|db|ui))/',
    ),
    forbidden(
      'ingest-never-touches-the-engine',
      'apps/uw-ingest verifies webhooks and enqueues; it never imports the engine.',
      '^apps/uw-ingest/',
      '^packages/harness/',
    ),
    forbidden(
      'islands-never-call-the-engine',
      'Islands call the command API, never the engine.',
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
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      mainFields: ['module', 'main', 'types'],
    },
    exclude: { path: ['^(apps|packages|sim|tests)/.*\\.d\\.ts$'] },
  },
};
