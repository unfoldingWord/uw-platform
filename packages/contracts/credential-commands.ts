import { z } from 'zod';
import { jdAreaSchema } from './areas.ts';
import { connectorSchema } from './closed-sets.ts';

export const credentialKindSchema = z.enum([
  'api_key',
  'oauth_refresh',
  'password',
  'ssh_key',
  'certificate',
]);

const NAME_MAX = 120;
const VALUE_MAX = 65_536;
const REVEAL_MINUTES_LEAST = 5;
const REVEAL_MINUTES_MOST = 1440;

const nameSchema = z
  .string()
  .min(1)
  .max(NAME_MAX)
  .refine((name) => name === name.trim(), 'a name carries no space at either end');
const jdRefSchema = z.string().regex(/^[0-9]{2}$|^[0-9]{2}\.[0-9]{2}$/);
const valueSchema = z.string().min(1).max(VALUE_MAX);
const effectConnectorSchema = connectorSchema.exclude(['none']);

export const createCredentialCommandSchema = z.strictObject({
  command: z.literal('create_credential'),
  requestId: z.uuid(),
  jdArea: jdAreaSchema,
  jdRef: jdRefSchema.nullable(),
  name: nameSchema,
  kind: credentialKindSchema,
  ownerId: z.uuid(),
  rotateBy: z.iso.date().nullable(),
  expiresAt: z.iso.datetime().nullable(),
  value: valueSchema,
});

export const rotateCredentialCommandSchema = z.strictObject({
  command: z.literal('rotate_credential'),
  requestId: z.uuid(),
  credentialId: z.uuid(),
  rotateBy: z.iso.date().nullable(),
  expiresAt: z.iso.datetime().nullable(),
  value: valueSchema,
});

export const revokeCredentialCommandSchema = z.strictObject({
  command: z.literal('revoke_credential'),
  requestId: z.uuid(),
  credentialId: z.uuid(),
});

export const bindCredentialCommandSchema = z.strictObject({
  command: z.literal('bind_credential'),
  requestId: z.uuid(),
  credentialId: z.uuid(),
  harnessId: z.uuid(),
  connectorKey: effectConnectorSchema,
});

export const unbindCredentialCommandSchema = z.strictObject({
  command: z.literal('unbind_credential'),
  requestId: z.uuid(),
  credentialId: z.uuid(),
  harnessId: z.uuid(),
  connectorKey: effectConnectorSchema,
});

export const grantRevealCommandSchema = z.strictObject({
  command: z.literal('grant_reveal'),
  requestId: z.uuid(),
  credentialId: z.uuid(),
  personId: z.uuid(),
  minutes: z.int().min(REVEAL_MINUTES_LEAST).max(REVEAL_MINUTES_MOST),
});

export const confirmRevealCommandSchema = z.strictObject({
  command: z.literal('confirm_reveal'),
  requestId: z.uuid(),
  grantId: z.uuid(),
});

export const revokeRevealCommandSchema = z.strictObject({
  command: z.literal('revoke_reveal'),
  requestId: z.uuid(),
  grantId: z.uuid(),
});

export const revealCredentialCommandSchema = z.strictObject({
  command: z.literal('reveal_credential'),
  requestId: z.uuid(),
  credentialId: z.uuid(),
});

export const credentialRevealedSchema = z.strictObject({
  status: z.literal('accepted'),
  requestId: z.uuid(),
  value: z.string(),
});

export type CredentialKind = z.infer<typeof credentialKindSchema>;
export type CreateCredentialCommand = z.infer<typeof createCredentialCommandSchema>;
export type RotateCredentialCommand = z.infer<typeof rotateCredentialCommandSchema>;
export type RevokeCredentialCommand = z.infer<typeof revokeCredentialCommandSchema>;
export type BindCredentialCommand = z.infer<typeof bindCredentialCommandSchema>;
export type UnbindCredentialCommand = z.infer<typeof unbindCredentialCommandSchema>;
export type GrantRevealCommand = z.infer<typeof grantRevealCommandSchema>;
export type ConfirmRevealCommand = z.infer<typeof confirmRevealCommandSchema>;
export type RevokeRevealCommand = z.infer<typeof revokeRevealCommandSchema>;
export type RevealCredentialCommand = z.infer<typeof revealCredentialCommandSchema>;
export type CredentialRevealed = z.infer<typeof credentialRevealedSchema>;
