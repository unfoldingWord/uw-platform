export const credentialKinds = [
  'api_key',
  'oauth_refresh',
  'password',
  'ssh_key',
  'certificate',
] as const;

export type CredentialKind = (typeof credentialKinds)[number];

export const credentialCiphers = ['aes-256-gcm'] as const;

export type CredentialCipher = (typeof credentialCiphers)[number];

export const credentialGrantCapabilities = ['reveal'] as const;

export const credentialAccessActions = [
  'create',
  'rotate',
  'revoke',
  'bind',
  'use',
  'reveal',
] as const;

export type CredentialAccessAction = (typeof credentialAccessActions)[number];

export const credentialAccessOutcomes = ['done', 'refused'] as const;

export type CredentialAccessOutcome = (typeof credentialAccessOutcomes)[number];

export const dataKeyRefusals = [
  'key_rejected',
  'key_service_refused',
  'key_service_unavailable',
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
  'value_not_storable',
  ...envelopeRefusals,
] as const;

export type CredentialRefusal = (typeof credentialRefusals)[number];
