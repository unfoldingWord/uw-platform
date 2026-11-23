import { z } from 'zod';
import { jdAreaSchema } from './areas.ts';
import { roleSchema, scopeSchema } from './closed-sets.ts';

export const grantRoleCommandSchema = z
  .object({
    command: z.literal('grant_role'),
    requestId: z.uuid(),
    personId: z.uuid(),
    role: roleSchema,
    scopeKind: scopeSchema,
    scopeArea: jdAreaSchema.nullable(),
    expiresAt: z.iso.datetime().nullable(),
  })
  .refine(
    (command) => (command.scopeKind === 'org') === (command.scopeArea === null),
    'org scope names no area; jd_area scope names one',
  );

export const revokeRoleCommandSchema = z.object({
  command: z.literal('revoke_role'),
  requestId: z.uuid(),
  grantId: z.uuid(),
});

export const approvePersonCommandSchema = z.object({
  command: z.literal('approve_person'),
  requestId: z.uuid(),
  personId: z.uuid(),
});

export const declinePersonCommandSchema = z.object({
  command: z.literal('decline_person'),
  requestId: z.uuid(),
  personId: z.uuid(),
});

export const PROFILE_BODY_MOST = 100_000;

export const saveProfileBodyCommandSchema = z.object({
  command: z.literal('save_profile_body'),
  requestId: z.uuid(),
  personId: z.uuid(),
  expectedVersion: z.number().int().min(1).nullable(),
  bodyMd: z.string().max(PROFILE_BODY_MOST),
});

export type GrantRoleCommand = z.infer<typeof grantRoleCommandSchema>;
export type RevokeRoleCommand = z.infer<typeof revokeRoleCommandSchema>;
export type ApprovePersonCommand = z.infer<typeof approvePersonCommandSchema>;
export type DeclinePersonCommand = z.infer<typeof declinePersonCommandSchema>;
export type SaveProfileBodyCommand = z.infer<typeof saveProfileBodyCommandSchema>;
