import type { Database } from '@uw/db/client';
import type { AppDeps } from '../deps.ts';
import type { Bindings } from '../env.ts';
import { awsKmsDataKeys } from './kms/aws.ts';
import { kmsConfigOf } from './kms/config.ts';
import { notConfiguredDataKeys } from './kms/not-configured.ts';
import type { CredentialsDeps } from './store.ts';

type KmsSettings = Pick<
  Bindings,
  | 'CREDENTIALS_KMS_REGION'
  | 'CREDENTIALS_KMS_KEY_ID'
  | 'CREDENTIALS_KMS_ACCESS_KEY_ID'
  | 'CREDENTIALS_KMS_SECRET_ACCESS_KEY'
>;

type Platform = Pick<AppDeps, 'fetch' | 'timers' | 'clock' | 'newId'>;

export function credentialsDepsOf(
  env: KmsSettings,
  db: Database,
  platform: Platform,
): CredentialsDeps {
  const config = kmsConfigOf(env);
  const keys =
    config === null
      ? notConfiguredDataKeys
      : awsKmsDataKeys(config, platform.fetch, platform.timers);
  return { db, keys, clock: platform.clock, newId: platform.newId };
}
