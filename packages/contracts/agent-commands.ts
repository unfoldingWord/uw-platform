import { z } from 'zod';
import { deviceSegmentSchema } from './identity.ts';

export const serviceClientIdSchema = z.string().trim().min(1).max(200);

export const bindServiceTokenCommandSchema = z.object({
  command: z.literal('bind_service_token'),
  requestId: z.uuid(),
  clientId: serviceClientIdSchema,
  personId: z.uuid(),
  device: deviceSegmentSchema,
});

export const revokeServiceTokenCommandSchema = z.object({
  command: z.literal('revoke_service_token'),
  requestId: z.uuid(),
  clientId: serviceClientIdSchema,
});

const routineChangeSchema = z.enum(['pause_routine', 'resume_routine', 'revoke_routine']);

export const routineChangeCommandSchema = z.object({
  command: routineChangeSchema,
  requestId: z.uuid(),
  routineId: z.uuid(),
});

export type BindServiceTokenCommand = z.infer<typeof bindServiceTokenCommandSchema>;
export type RevokeServiceTokenCommand = z.infer<typeof revokeServiceTokenCommandSchema>;
export type RoutineChangeCommand = z.infer<typeof routineChangeCommandSchema>;
