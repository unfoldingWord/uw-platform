import { z } from 'zod';

export const assistantMailRefusalSchema = z.enum([
  'automated_sender',
  'other_sender',
  'unverified_sender',
  'email_instructions_off',
  'email_not_bound',
]);

export type AssistantMailRefusal = z.infer<typeof assistantMailRefusalSchema>;
