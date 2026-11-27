import { describe, expect, it } from 'vitest';
import {
  assistantCalendarRefusalSchema,
  assistantEffectFailureSchema,
  assistantHoldStatusSchema,
} from './assistants.ts';
import { untrustedSourceSchema } from './closed-sets.ts';
import { eventEvidenceSchemas } from './event-evidence.ts';
import { eventNameSchema } from './events.ts';
import { verbIo } from './verb-io.ts';
import { findVerb } from './verbs.ts';

const id = '00000000-0000-4000-8000-0000000000f1';
const other = '00000000-0000-4000-8000-0000000000f2';

describe('PA-8 the calendar contracts', () => {
  it('names the hold events and keeps their evidence to ids', () => {
    for (const name of ['assistant_hold_placed', 'assistant_hold_released']) {
      expect(eventNameSchema.safeParse(name).success).toBe(true);
    }
    const placed = eventEvidenceSchemas.assistant_hold_placed;
    expect(placed.safeParse({ holdId: id, effectId: other }).success).toBe(true);
    expect(placed.safeParse({ holdId: id, effectId: other, title: 'Focus' }).success).toBe(false);
    const released = eventEvidenceSchemas.assistant_hold_released;
    expect(released.safeParse({ holdId: id, effectId: other }).success).toBe(true);
  });

  it('closes the hold statuses, the calendar refusals and the calendar failures', () => {
    expect([...assistantHoldStatusSchema.options]).toEqual(['held', 'released']);
    expect([...assistantCalendarRefusalSchema.options]).toEqual([
      'outside_organization',
      'hold_in_past',
      'hold_too_long',
      'hold_too_far',
      'holds_capped',
      'hold_not_found',
      'calendar_refused',
      'calendar_unavailable',
      'calendar_not_wired',
    ]);
    for (const why of ['calendar_refused', 'calendar_unavailable', 'not_own_hold']) {
      expect(assistantEffectFailureSchema.safeParse(why).success).toBe(true);
    }
  });

  it('fences calendar text as its own untrusted source', () => {
    expect(untrustedSourceSchema.safeParse('calendar_event').success).toBe(true);
  });
});

describe('PA-8 and PA-9 the calendar verbs', () => {
  it('registers the four calendar verbs in the assistant group, served only in a turn', () => {
    for (const name of ['read_my_calendar', 'find_free_time', 'hold_time', 'release_hold']) {
      const verb = findVerb(name);
      expect(verb?.group).toBe('assistant');
      expect(verb?.servedInV1).toBe(false);
      expect(verb?.grant).toBeNull();
    }
  });

  it('gives hold_time a title and two instants, and no attendee or calendar', () => {
    const input = verbIo.hold_time.input;
    const hold = { title: 'Focus', start: '2026-12-01T09:00:00Z', end: '2026-12-01T10:00:00Z' };
    expect(input.safeParse(hold).success).toBe(true);
    expect(input.safeParse({ ...hold, attendees: ['ana@example.org'] }).success).toBe(false);
    expect(input.safeParse({ ...hold, calendarId: 'someone@example.org' }).success).toBe(false);
    expect(input.safeParse({ ...hold, title: '' }).success).toBe(false);
    expect(verbIo.release_hold.input.safeParse({ holdId: id }).success).toBe(true);
    expect(verbIo.release_hold.input.safeParse({ eventId: 'abc' }).success).toBe(false);
  });

  it('reads a day of the calendar by date and finds time with at most ten colleagues', () => {
    expect(verbIo.read_my_calendar.input.safeParse({}).success).toBe(true);
    expect(verbIo.read_my_calendar.input.safeParse({ day: '2026-12-01', days: 7 }).success).toBe(
      true,
    );
    expect(verbIo.read_my_calendar.input.safeParse({ days: 15 }).success).toBe(false);
    const find = verbIo.find_free_time.input;
    expect(find.safeParse({ with: ['ana@example.org'], minutes: 30 }).success).toBe(true);
    const eleven = Array.from({ length: 11 }, (_, n) => `p${String(n)}@example.org`);
    expect(find.safeParse({ with: eleven, minutes: 30 }).success).toBe(false);
    expect(find.safeParse({ with: ['not an address'], minutes: 30 }).success).toBe(false);
    expect(find.safeParse({ with: [], minutes: 5 }).success).toBe(false);
  });
});
