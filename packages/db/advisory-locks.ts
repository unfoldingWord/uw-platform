import { sql, type SQL } from 'drizzle-orm';

export const advisoryLocks = {
  grantCommands: 'acl-grant-commands',
  pageReparenting: 'pages-reparenting',
} as const;

export const lockKeyPrefixes: readonly string[] = [
  'harness-stage-claims:',
  'harness-stages:',
  'harness_events:',
  'github-issue:',
  'persona-activation:',
  'harness-breaker',
  'harness-run-persona:',
  'zulip-topics:',
];

export function advisoryLock(key: string): SQL {
  return sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
}

export function advisoryLockShared(key: string): SQL {
  return sql`SELECT pg_advisory_xact_lock_shared(hashtextextended(${key}, 0))`;
}
