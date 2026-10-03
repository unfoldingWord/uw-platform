import { describe, expect, it } from 'vitest';
import { commandNames, commandSchema, harnessCommandSchemas } from './commands.ts';

const requestId = '00000000-0000-4000-8000-0000000000aa';
const itemId = '00000000-0000-4000-8000-0000000000bb';
const head = 'a'.repeat(40);

describe('WB-1 every control is a command with a requestId', () => {
  it('names a body schema for every command and no other', () => {
    expect(Object.keys(harnessCommandSchemas).sort()).toEqual([...commandNames].sort());
  });

  it('refuses every command body without a requestId', () => {
    for (const name of commandNames) {
      expect(commandSchema.safeParse({ command: name }).success).toBe(false);
    }
  });
});

describe('command bodies', () => {
  it('refuses a field the command does not name', () => {
    expect(
      commandSchema.safeParse({ command: 'claim', requestId, itemId, delegationId: null }).success,
    ).toBe(false);
  });

  it('takes an import by repository and number, never a GitHub id', () => {
    const base = { command: 'import', requestId, repository: 'unfoldingWord/uw-platform' };
    expect(commandSchema.safeParse({ ...base, number: 7 }).success).toBe(true);
    expect(commandSchema.safeParse({ ...base, number: 7, githubId: 9 }).success).toBe(false);
  });

  it('needs a non-blank reason and the seen head on an override', () => {
    const base = { command: 'override', requestId, itemId, head };
    expect(commandSchema.safeParse({ ...base, reason: '  ' }).success).toBe(false);
    expect(commandSchema.safeParse({ ...base, reason: 'reviewed by hand' }).success).toBe(true);
  });

  it('takes a pull request and its head together or neither on submit', () => {
    const base = { command: 'submit_to_gate', requestId, itemId, to: null };
    const pullRequest = { repo: 'unfoldingWord/uw-platform', number: 7 };
    expect(commandSchema.safeParse({ ...base, pullRequest, head }).success).toBe(true);
    expect(commandSchema.safeParse({ ...base, pullRequest: null, head: null }).success).toBe(true);
    expect(commandSchema.safeParse({ ...base, pullRequest, head: null }).success).toBe(false);
  });

  it('refuses a stage change that names no column or pauses the lane', () => {
    const base = { command: 'update_stage', requestId, stageKey: 'review' };
    expect(commandSchema.safeParse({ ...base, change: { title: 'Review' } }).success).toBe(true);
    expect(commandSchema.safeParse({ ...base, change: {} }).success).toBe(false);
    expect(commandSchema.safeParse({ ...base, change: { paused: true } }).success).toBe(false);
  });
});

describe('WB-2 reorder names the item to place before, never an index', () => {
  it('takes beforeItemId or null and refuses a position', () => {
    const base = { command: 'reorder', requestId, itemId };
    expect(commandSchema.safeParse({ ...base, beforeItemId: null }).success).toBe(true);
    expect(commandSchema.safeParse({ ...base, beforeItemId: itemId }).success).toBe(true);
    expect(commandSchema.safeParse({ ...base, position: 2 }).success).toBe(false);
  });
});
