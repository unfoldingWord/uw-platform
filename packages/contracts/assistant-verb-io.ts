import { z } from 'zod';
import { assistantProposalPayloadSchemas as proposalOf } from './assistant-proposals.ts';
import { assistantResearchVerbIo } from './assistant-research.ts';

const reminderText = z.string().trim().min(1).max(500);
const drafted = z.object({ effectId: z.uuid(), status: z.literal('drafted') });
const calendarDays = z.number().int().min(1).max(14);
const instant = z.iso.datetime({ offset: true });
const calendarEvent = z.object({
  startAt: z.iso.datetime(),
  endAt: z.iso.datetime(),
  when: z.string(),
  allDay: z.boolean(),
  organisedByYou: z.boolean(),
  attendees: z.number().int().min(0),
  holdId: z.uuid().nullable(),
  details: z.string(),
});
const proposed = z.object({ proposalId: z.uuid(), status: z.literal('pending') });
const freeSlot = z.object({ startAt: z.iso.datetime(), endAt: z.iso.datetime(), when: z.string() });

export const assistantVerbIo = {
  set_reminder: {
    input: z.strictObject({
      text: reminderText,
      dueAt: z.iso.datetime({ offset: true }),
    }),
    output: drafted,
  },
  cancel_reminder: {
    input: z.strictObject({ reminderId: z.uuid() }),
    output: drafted,
  },
  list_reminders: {
    input: z.strictObject({}),
    output: z.object({
      reminders: z.array(
        z.object({ reminderId: z.uuid(), text: z.string(), dueAt: z.iso.datetime() }),
      ),
    }),
  },
  read_my_calendar: {
    input: z.strictObject({ day: z.iso.date().optional(), days: calendarDays.optional() }),
    output: z.object({
      timezone: z.string(),
      from: z.iso.datetime(),
      to: z.iso.datetime(),
      events: z.array(calendarEvent),
      truncated: z.boolean(),
    }),
  },
  find_free_time: {
    input: z.strictObject({
      with: z.array(z.email()).max(10),
      minutes: z.number().int().min(15).max(480),
      day: z.iso.date().optional(),
      days: calendarDays.optional(),
    }),
    output: z.object({
      timezone: z.string(),
      slots: z.array(freeSlot).max(10),
      unknown: z.array(z.string()),
    }),
  },
  hold_time: {
    input: z.strictObject({
      title: z.string().trim().min(1).max(200),
      start: instant,
      end: instant,
    }),
    output: drafted,
  },
  release_hold: {
    input: z.strictObject({ holdId: z.uuid() }),
    output: drafted,
  },
  propose_email: { input: proposalOf.email, output: proposed },
  propose_invite: { input: proposalOf.invite, output: proposed },
  propose_page_append: { input: proposalOf.page_append, output: proposed },
  ...assistantResearchVerbIo,
};
