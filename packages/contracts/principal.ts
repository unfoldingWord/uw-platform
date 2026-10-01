import { z } from 'zod';
import { jdAreaSchema } from './areas.ts';
import { principalKindSchema, roleSchema } from './closed-sets.ts';
import { identitySchema } from './identity.ts';

const instant = z.iso.datetime();

export const grantSchema = z.discriminatedUnion('scopeKind', [
  z.object({
    grantId: z.uuid(),
    role: roleSchema,
    scopeKind: z.literal('org'),
    scopeArea: z.null(),
    expiresAt: instant.nullable(),
  }),
  z.object({
    grantId: z.uuid(),
    role: roleSchema,
    scopeKind: z.literal('jd_area'),
    scopeArea: jdAreaSchema,
    expiresAt: instant.nullable(),
  }),
]);

export const principalSchema = z
  .object({
    identity: identitySchema,
    kind: principalKindSchema,
    personId: z.uuid().nullable(),
    email: z.email().nullable(),
    grants: z.array(grantSchema),
    interactive: z.boolean(),
  })
  .refine(
    (principal) =>
      principal.kind === 'person'
        ? principal.identity === `human:${principal.personId ?? ''}` && principal.email !== null
        : principal.identity.startsWith('agent:'),
    'a person principal is human:<personId> with an email; an agent principal is agent:…',
  );

export type Grant = z.infer<typeof grantSchema>;
export type Principal = z.infer<typeof principalSchema>;
