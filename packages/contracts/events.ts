import { z } from 'zod';
import { identitySchema } from './identity.ts';

export const eventNameSchema = z.enum([
  'gate_approved',
  'lease_expired',
  'delegation_lapsed',
  'abandoned',
]);

export const eventSchema = z.object({
  eventId: z.uuid(),
  harnessId: z.uuid(),
  name: eventNameSchema,
  at: z.iso.datetime(),
  actor: identitySchema,
  payload: z.record(z.string(), z.json()),
});

export type EventName = z.infer<typeof eventNameSchema>;
export type HarnessEvent = z.infer<typeof eventSchema>;
