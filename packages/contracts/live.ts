import { z } from 'zod';
import { eventSchema } from './events.ts';

export const hubWakeSchema = z.strictObject({ type: z.literal('wake'), harnessId: z.uuid() });

export const eventPageReplySchema = z.strictObject({
  events: z.array(eventSchema).max(100),
  next: z.number().int().min(0).nullable(),
});

export const eventQuerySchema = z.strictObject({
  after: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(100),
  item: z.uuid().optional(),
});

export type HubWake = z.infer<typeof hubWakeSchema>;
export type EventPageReply = z.infer<typeof eventPageReplySchema>;
export type EventReadQuery = z.infer<typeof eventQuerySchema>;
