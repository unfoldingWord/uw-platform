import { describe, expect, it } from 'vitest';
import { advisoryLocks, lockKeyPrefixes } from './advisory-locks.ts';

function clashes(keys: readonly string[]): string[] {
  return keys.flatMap((key, index) =>
    keys
      .filter((other, at) => at !== index && other.startsWith(key))
      .map((other) => `${key} ${other}`),
  );
}

describe('FD-8 FD-9 advisory lock keys live in one registry, in one key space', () => {
  it('names the grant-command and page re-parent keys as strings', () => {
    expect(advisoryLocks).toEqual({
      grantCommands: 'acl-grant-commands',
      pageReparenting: 'pages-reparenting',
    });
  });

  it('lists the string key prefixes the kernel and the event trigger use', () => {
    expect(lockKeyPrefixes).toEqual([
      'harness-stage-claims:',
      'harness-stages:',
      'harness_events:',
      'github-issue:',
      'persona-activation:',
      'persona-identity:',
      'harness-breaker',
      'harness-run-persona:',
      'zulip-topics:',
    ]);
  });

  it('keeps every key distinct from, and no prefix of, another', () => {
    expect(clashes([...Object.values(advisoryLocks), ...lockKeyPrefixes])).toEqual([]);
    expect(clashes(['a', 'ab'])).toEqual(['a ab']);
  });
});
