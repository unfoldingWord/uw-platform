import type { RiskDomain } from '@uw/contracts';

export type ProtectedDirectory = { readonly path: string; readonly domain: RiskDomain };

export const protectedDirectories: readonly ProtectedDirectory[] = [
  { path: 'packages/db/migrations/', domain: 'migration' },
  { path: 'packages/core/acl.ts', domain: 'acl' },
  { path: 'apps/uw-app/acl/', domain: 'acl' },
  { path: 'infra/', domain: 'infra' },
  { path: '.github/workflows/', domain: 'infra' },
  { path: 'packages/ledger/', domain: 'ledger' },
  { path: 'packages/harness/risk/', domain: 'acl' },
  { path: 'packages/harness/ship-rule.ts', domain: 'acl' },
  { path: 'packages/harness/gates/', domain: 'acl' },
];
