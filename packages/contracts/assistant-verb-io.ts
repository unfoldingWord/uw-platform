import { z } from 'zod';

const reminderText = z.string().trim().min(1).max(500);
const drafted = z.object({ effectId: z.uuid(), status: z.literal('drafted') });

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
};
