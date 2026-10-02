import { describe, expect, it } from 'vitest';
import { isForbiddenVerbName, verbNames } from './verb-names.ts';

describe('isForbiddenVerbName names a verb forbidden when any forbidden verb is inside its trimmed, lowercased name', () => {
  it.each([
    'approve',
    'Approve',
    'APPROVE',
    'approve_item',
    'gate_approve',
    'merge_pr',
    'deploy',
    'publish_page',
    'advance',
    'advance_item',
    ' approve',
  ])('forbids %j', (name) => {
    expect(isForbiddenVerbName(name)).toBe(true);
  });

  it.each(['nope', 'summarise_measurements', 'list_gifts', ''])('allows %j', (name) => {
    expect(isForbiddenVerbName(name)).toBe(false);
  });

  it('forbids no registered verb name', () => {
    expect(verbNames.filter(isForbiddenVerbName)).toEqual([]);
  });
});
