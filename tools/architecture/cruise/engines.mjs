import { vendorSdk, testFile, engineKeys, engineDirectory } from './shared.mjs';

export const engineRules = [
  {
    name: 'vendor-sdk-only-in-engines',
    comment: 'A vendor SDK is imported only inside one of the six apps/uw-app/engines/<key>/.',
    severity: 'error',
    from: { path: '^(apps|packages|sim|tests)/', pathNot: engineDirectory },
    to: { path: vendorSdk },
  },
  {
    name: 'engines-only-from-the-seam',
    comment:
      'An engine directory is imported only by the engine registry, its own files and tests, so the platform reaches an engine only through the seam.',
    severity: 'error',
    from: { pathNot: ['^apps/uw-app/engines/registry\\.ts$', engineDirectory, testFile] },
    to: { path: engineDirectory },
  },
  {
    name: 'engines-never-import-another-engine',
    comment: 'An engine imports nothing from another engine directory.',
    severity: 'error',
    from: { path: `^apps/uw-app/engines/${engineKeys}/` },
    to: { path: engineDirectory, pathNot: '^apps/uw-app/engines/$1/' },
  },
  {
    name: 'engines-gateway-only-from-the-roots',
    comment:
      'The AI Gateway spend reader is imported only by the composition roots that build the breaker and by tests.',
    severity: 'error',
    from: {
      pathNot: [
        '^apps/uw-app/engines/gateway/',
        '^apps/uw-app/(kernel|cron/minute|runs/deps)\\.ts$',
        testFile,
      ],
    },
    to: { path: '^apps/uw-app/engines/gateway/' },
  },
  {
    name: 'engines-reach-only-the-tool-caller',
    comment:
      'An engine reaches the platform only through the MCP tool caller it is handed: never the database, the kernel, a port, the MCP surface or GitHub.',
    severity: 'error',
    from: { path: '^apps/uw-app/engines/', pathNot: testFile },
    to: {
      path: [
        '^packages/db/',
        '^apps/uw-app/(kernel|database)\\.ts$',
        '^apps/uw-app/(ports|mcp|github)/',
      ],
    },
  },
];
