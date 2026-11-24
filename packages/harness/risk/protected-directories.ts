import type { RiskDomain } from '@uw/contracts';

export type ProtectedDirectory = { readonly path: string; readonly domain: RiskDomain };

export const protectedDirectories: readonly ProtectedDirectory[] = [
  { path: 'packages/db/migrations/', domain: 'migration' },
  { path: 'packages/core/acl.ts', domain: 'acl' },
  { path: 'apps/uw-platform/acl/', domain: 'acl' },
  { path: 'infra/', domain: 'infra' },
  { path: '.github/', domain: 'infra' },
  { path: '.dependency-cruiser.mjs', domain: 'infra' },
  { path: 'tools/architecture/', domain: 'infra' },
  { path: 'packages/ledger/', domain: 'ledger' },
  { path: 'packages/harness/risk/', domain: 'acl' },
  { path: 'packages/harness/ship-rule.ts', domain: 'acl' },
  { path: 'packages/harness/gates/', domain: 'acl' },
  { path: 'packages/harness/github/', domain: 'acl' },
  { path: 'apps/uw-platform/github/', domain: 'acl' },
  { path: 'apps/uw-platform/ports/', domain: 'acl' },
  { path: 'apps/uw-platform/engines/sandbox/', domain: 'acl' },
  { path: 'apps/uw-platform/kernel.ts', domain: 'acl' },
  { path: 'apps/uw-platform/commands/person/gate-kernel.ts', domain: 'acl' },
  { path: 'apps/uw-platform/commands/person/gate-github.ts', domain: 'acl' },
  { path: 'apps/uw-platform/commands/dispatch.ts', domain: 'acl' },
  { path: 'apps/uw-platform/commands/capabilities.ts', domain: 'acl' },
  { path: 'apps/uw-platform/commands/person-deps.ts', domain: 'acl' },
  { path: 'packages/contracts/ship-rule.ts', domain: 'acl' },
];
