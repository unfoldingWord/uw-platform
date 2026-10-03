import { npm, vendorSdk, testFile, engineKeys, engineDirectory } from './shared.mjs';

const environment = '^apps/uw-app/env\\.ts$';
const enginesMayImport = [
  '^packages/(harness|contracts)/',
  npm('zod'),
  ...vendorSdk,
  '^apps/uw-app/engines/(seam|config|tool-schemas)\\.ts$',
  environment,
];

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
      'An engine reaches the platform only through the MCP tool caller it is handed: it imports the harness, the contracts, zod, the vendor SDKs, the shared seam files and its own directory, and nothing else, so no chain of imports reaches the database, the kernel, a port, the MCP surface or GitHub.',
    severity: 'error',
    from: { path: '^apps/uw-app/engines/([^/]+)/', pathNot: testFile },
    to: { pathNot: [...enginesMayImport, '^apps/uw-app/engines/$1/'] },
  },
  {
    name: 'engine-seam-reaches-only-the-engines',
    comment:
      'The seam files at the top of apps/uw-app/engines/ import what an engine may, plus the engine directories, and nothing else.',
    severity: 'error',
    from: { path: '^apps/uw-app/engines/[^/]+\\.ts$', pathNot: testFile },
    to: { pathNot: [...enginesMayImport, '^apps/uw-app/engines/'] },
  },
  {
    name: 'engines-read-the-environment-as-types-only',
    comment:
      'An engine names the Worker environment only as a type; its values come through the engine configuration.',
    severity: 'error',
    from: { path: '^apps/uw-app/engines/', pathNot: testFile },
    to: { path: environment, dependencyTypesNot: ['type-only'] },
  },
];
