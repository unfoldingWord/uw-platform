import { describe, expect, it } from 'vitest';
import {
  assistantEffectFailureSchema,
  assistantReminderRefusalSchema,
  assistantReminderStatusSchema,
} from './assistants.ts';
import { eventEvidenceSchemas } from './event-evidence.ts';
import { eventNameSchema } from './events.ts';
import { verbIo } from './verb-io.ts';
import { findVerb } from './verbs.ts';

const id = '00000000-0000-4000-8000-0000000000f1';
const other = '00000000-0000-4000-8000-0000000000f2';

describe('PA-5 the reminder contracts', () => {
  it('names the four reminder events', () => {
    for (const name of [
      'assistant_reminder_set',
      'assistant_reminder_cancelled',
      'assistant_reminder_fired',
      'assistant_reminder_undelivered',
    ]) {
      expect(eventNameSchema.safeParse(name).success).toBe(true);
    }
  });

  it('keeps reminder evidence to ids and closed sets, never the text', () => {
    const set = eventEvidenceSchemas.assistant_reminder_set;
    expect(set.safeParse({ reminderId: id, effectId: other }).success).toBe(true);
    expect(set.safeParse({ reminderId: id, effectId: other, text: 'Call Ana' }).success).toBe(
      false,
    );
    const fired = eventEvidenceSchemas.assistant_reminder_fired;
    expect(fired.safeParse({ reminderId: id }).success).toBe(true);
    const undelivered = eventEvidenceSchemas.assistant_reminder_undelivered;
    expect(undelivered.safeParse({ reminderId: id, why: 'delegation_lapsed' }).success).toBe(true);
    expect(undelivered.safeParse({ reminderId: id, why: 'late' }).success).toBe(false);
  });

  it('closes the reminder statuses, refusals and the closed-reminder failure', () => {
    expect([...assistantReminderStatusSchema.options]).toEqual([
      'set',
      'fired',
      'cancelled',
      'undelivered',
    ]);
    expect([...assistantReminderRefusalSchema.options]).toEqual([
      'due_in_past',
      'due_too_far',
      'effects_capped',
      'reminders_capped',
      'reminder_not_found',
    ]);
    expect(assistantEffectFailureSchema.safeParse('reminder_closed').success).toBe(true);
  });
});

describe('PA-5 the reminder verbs', () => {
  it('registers the reminder verbs in the assistant group, not served yet', () => {
    for (const name of ['set_reminder', 'cancel_reminder', 'list_reminders']) {
      const verb = findVerb(name);
      expect(verb?.group).toBe('assistant');
      expect(verb?.servedInV1).toBe(false);
      expect(verb?.grant).toBeNull();
    }
  });

  it('gives set_reminder only a text and a due instant, and no recipient', () => {
    const input = verbIo.set_reminder.input;
    expect(input.safeParse({ text: 'Call Ana', dueAt: '2026-12-01T09:00:00Z' }).success).toBe(true);
    expect(
      input.safeParse({ text: 'Call Ana', dueAt: '2026-12-01T09:00:00Z', to: 'x' }).success,
    ).toBe(false);
    expect(input.safeParse({ text: '', dueAt: '2026-12-01T09:00:00Z' }).success).toBe(false);
    expect(input.safeParse({ text: 'Call Ana', dueAt: '2026-12-01' }).success).toBe(false);
    expect(verbIo.cancel_reminder.input.safeParse({ reminderId: id }).success).toBe(true);
    expect(verbIo.list_reminders.input.safeParse({}).success).toBe(true);
  });
});
