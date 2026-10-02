import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { lockKeyPrefixes } from '../../packages/db/advisory-locks.ts';
import { lockKeys } from '../../packages/harness/lock-keys.ts';
import { repoFiles } from '../repo-files.ts';

const forbiddenLock = /pg_try_advisory_|pg_advisory_(?:xact_)?lock(?:_shared)?\(\s*(?:\d|\$\{)/;

function numericLocks(files: readonly string[], read: (file: string) => string): string[] {
  return files
    .filter((file) => /\.(?:tsx?|m?js|sql)$/.test(file) && !file.includes('node_modules'))
    .filter((file) => file !== 'tools/architecture/lock-keys.test.ts')
    .filter((file) => forbiddenLock.test(read(file)));
}

describe('every advisory lock goes through one string key space, with try, shared and uncast keys flagged', () => {
  it('registers the kernel lock key prefixes', () => {
    const kernel = [
      lockKeys.stageClaims(''),
      lockKeys.harnessStages(''),
      lockKeys.harnessEvents(''),
      lockKeys.personaActivation(''),
      lockKeys.githubIssue(9100000001).replace(/9100000001$/, ''),
    ];
    expect(kernel.filter((prefix) => !lockKeyPrefixes.includes(prefix))).toEqual([]);
  });

  it('finds no numeric advisory lock in the repository', () => {
    expect(numericLocks(repoFiles(), (file) => readFileSync(file, 'utf8'))).toEqual([]);
  });

  it.each([
    'sql`SELECT pg_advisory_xact_lock(${keys.grantCommands}::bigint)`',
    'SELECT pg_advisory_lock(7301001)',
    'SELECT pg_try_advisory_xact_lock(hashtextextended(${key}, 0))',
    'sql`SELECT pg_advisory_xact_lock(${n})`',
    'SELECT pg_advisory_lock_shared(42)',
  ])('flags %s', (source) => {
    expect(numericLocks(['apps/uw-app/x.ts'], () => source)).toEqual(['apps/uw-app/x.ts']);
  });
});
