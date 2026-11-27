import { describe, expect, it } from 'vitest';
import { mailInstructionsOf } from './assistant-mail.ts';

describe('PA-10 the email instructions flag', () => {
  it('is on only when ASSISTANT_EMAIL_INSTRUCTIONS is exactly on', () => {
    expect(mailInstructionsOf({ ASSISTANT_EMAIL_INSTRUCTIONS: 'on' })).toBe('on');
    expect(mailInstructionsOf({})).toBe('off');
    for (const value of ['', 'off', 'ON ', 'yes', 'true']) {
      expect(mailInstructionsOf({ ASSISTANT_EMAIL_INSTRUCTIONS: value })).toBe('off');
    }
  });
});
