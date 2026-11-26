import { describe, expect, it } from 'vitest';
import { DEFAULT_TIMEZONE, instructionsOf } from './instructions.ts';

const body = '---\nname: assistant\n---\n\n## Limits\nYou never write a page.';
const context = { now: new Date('2026-10-01T09:00:00.000Z'), channel: 'zulip_dm' } as const;
const settings = {
  displayName: 'Iris',
  instructionsMd: 'Answer in French.',
  timezone: 'Africa/Nairobi',
};

describe('PA-2 the role comes first and the person adds to it', () => {
  it('puts the role body, then the person instructions under the role limits, then the context', () => {
    const text = instructionsOf(body, settings, context);
    const role = text.indexOf('## Limits');
    const own = text.indexOf("The person's own instructions (the role's limits win)");
    const added = text.indexOf('Answer in French.');
    const situation = text.indexOf('## Context');
    expect(role).toBeGreaterThanOrEqual(0);
    expect(own).toBeGreaterThan(role);
    expect(added).toBeGreaterThan(own);
    expect(situation).toBeGreaterThan(added);
    expect(text).toContain('2026-10-01T09:00:00.000Z');
    expect(text).toContain('Africa/Nairobi');
    expect(text).toContain('Iris');
    expect(text).toContain('zulip_dm');
  });

  it('keeps the role and a default context when the person has customised nothing', () => {
    const text = instructionsOf(body, null, context);
    expect(text.startsWith(body)).toBe(true);
    expect(text).not.toContain("The person's own instructions");
    expect(text).toContain(DEFAULT_TIMEZONE);
  });

  it('adds no section for blank instructions', () => {
    const text = instructionsOf(body, { ...settings, instructionsMd: '   ' }, context);
    expect(text).not.toContain("The person's own instructions");
  });
});
