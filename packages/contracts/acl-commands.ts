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

export type GrantRoleCommand = z.infer<typeof grantRoleCommandSchema>;
export type RevokeRoleCommand = z.infer<typeof revokeRoleCommandSchema>;
