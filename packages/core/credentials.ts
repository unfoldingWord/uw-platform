import { credentialKindSchema, type CredentialKind } from '@uw/contracts';

export const credentialKinds = credentialKindSchema.options;

export type { CredentialKind };

export const credentialCiphers = ['aes-256-gcm'] as const;

export type CredentialCipher = (typeof credentialCiphers)[number];

export const credentialGrantCapabilities = ['reveal'] as const;

export const credentialAccessActions = [
  'create',
  'rotate',
  'revoke',
  'bind',
  'unbind',
  'use',
  'reveal',
  'grant_reveal',
  'confirm_reveal',
  'revoke_reveal',
] as const;

export type CredentialAccessAction = (typeof credentialAccessActions)[number];

export const credentialAccessOutcomes = ['done', 'refused'] as const;

export type CredentialAccessOutcome = (typeof credentialAccessOutcomes)[number];

export const dataKeyRefusals = [
  'key_rejected',
  'key_service_refused',
  'key_service_unavailable',
  'key_service_not_configured',
] as const;

export type DataKeyRefusal = (typeof dataKeyRefusals)[number];

export const envelopeRefusals = [
  ...dataKeyRefusals,
  'ciphertext_rejected',
  'envelope_malformed',
] as const;

export type EnvelopeRefusal = (typeof envelopeRefusals)[number];

export const credentialRefusals = [
  'not_permitted',
  'credential_revoked',
  'credential_expired',
  ...envelopeRefusals,
] as const;

export type CredentialRefusal = (typeof credentialRefusals)[number];

export const REVEAL_GRANT_MINUTES = { least: 5, most: 1440 } as const;
