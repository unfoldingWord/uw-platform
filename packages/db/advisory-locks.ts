import { sql, type SQL } from 'drizzle-orm';

export const advisoryLocks = {
  grantCommands: 'acl-grant-commands',
  pageReparenting: 'pages-reparenting',
} as const;

export const lockKeyPrefixes: readonly string[] = [
  'harness-stage-claims:',
  'harness-stages:',
  'harness_events:',
  'persona-activation:',
];

export function advisoryLock(key: string): SQL {
  return sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
}
