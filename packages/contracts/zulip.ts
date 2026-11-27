import { z } from 'zod';

export const ZULIP_TEXT_LIMIT = 10_000;

export const zulipTopicSchema = z
  .string()
  .min(1)
  .max(60)
  .refine((value) => !/[\r\n]/.test(value) && value.trim() === value, 'one trimmed line');

const zulipId = z
  .number()
  .int()
  .min(1)
  .max(2 ** 48);

export const zulipRecipientSchema = z.object({
  id: zulipId,
  email: z.string().min(3).max(254),
  full_name: z.string().max(200),
});

const message = z.object({
  id: zulipId,
  sender_id: zulipId.optional(),
  sender_email: z.string().min(3).max(254),
  type: z.enum(['stream', 'private']),
  display_recipient: z.union([z.string().max(200), z.array(zulipRecipientSchema).max(100)]),
  subject: z.string().max(200),
  content: z.string(),
  timestamp: z.number().int().min(0).optional(),
});

export const zulipOutgoingSchema = z.object({
  token: z.string().min(1).max(200),
  trigger: z.string().min(1).max(50),
  bot_email: z.string().min(3).max(254).optional(),
  message,
});
export const zulipMessageSchema = zulipOutgoingSchema.omit({ token: true });
export type ZulipOutgoing = z.infer<typeof zulipOutgoingSchema>;
export type ZulipMessage = z.infer<typeof zulipMessageSchema>;
export type ZulipRecipient = z.infer<typeof zulipRecipientSchema>;
