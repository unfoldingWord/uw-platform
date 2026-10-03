import type { RiskDomain } from '@uw/contracts';

export type ProtectedDirectory = { readonly path: string; readonly domain: RiskDomain };

export const protectedDirectories: readonly ProtectedDirectory[] = [
  { path: 'packages/db/migrations/', domain: 'migration' },
  { path: 'packages/core/acl.ts', domain: 'acl' },
  { path: 'apps/uw-app/acl/', domain: 'acl' },
  { path: 'infra/', domain: 'infra' },
  { path: '.github/', domain: 'infra' },
  { path: '.dependency-cruiser.mjs', domain: 'infra' },
  { path: 'tools/architecture/', domain: 'infra' },
  { path: 'packages/ledger/', domain: 'ledger' },
  { path: 'packages/harness/risk/', domain: 'acl' },
  { path: 'packages/harness/ship-rule.ts', domain: 'acl' },
  { path: 'packages/harness/gates/', domain: 'acl' },
  { path: 'packages/harness/github/', domain: 'acl' },
  { path: 'apps/uw-app/github/', domain: 'acl' },
  { path: 'apps/uw-app/ports/', domain: 'acl' },
  { path: 'apps/uw-app/kernel.ts', domain: 'acl' },
  { path: 'apps/uw-app/commands/person/gate-kernel.ts', domain: 'acl' },
  { path: 'apps/uw-app/commands/person/gate-github.ts', domain: 'acl' },
  { path: 'apps/uw-app/commands/dispatch.ts', domain: 'acl' },
  { path: 'apps/uw-app/commands/capabilities.ts', domain: 'acl' },
  { path: 'apps/uw-app/commands/person-deps.ts', domain: 'acl' },
  { path: 'packages/contracts/ship-rule.ts', domain: 'acl' },
];
