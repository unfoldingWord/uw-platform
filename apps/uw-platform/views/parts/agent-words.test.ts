import { describe, expect, it } from 'vitest';
import { notBuiltActions } from './agent-words.ts';

describe('PA-17 the agent card does not call the assistant verbs unbuilt', () => {
  it('leaves the reminder verbs, served only in an assistant turn, out of the not-built list', () => {
    const names = notBuiltActions().map((words) => words.name);
    expect(names).not.toContain('set_reminder');
    expect(names).not.toContain('cancel_reminder');
    expect(names).not.toContain('list_reminders');
    expect(names).toContain('list_gifts');
  });
});
