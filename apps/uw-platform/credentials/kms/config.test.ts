import { describe, expect, it } from 'vitest';
import { kmsConfigOf } from './config.ts';

const arn = 'arn:aws:kms:us-east-1:000000000000:key/1b9c6f0e-0000-4000-8000-000000000157';
const env = {
  CREDENTIALS_KMS_REGION: 'us-east-1',
  CREDENTIALS_KMS_KEY_ID: arn,
  CREDENTIALS_KMS_ACCESS_KEY_ID: 'AKIDFAKEFORTESTS',
  CREDENTIALS_KMS_SECRET_ACCESS_KEY: 'fake-signing-secret-for-tests-only',
};

describe('#157 the KMS configuration is read from four Worker settings', () => {
  it('reads the region, the key and the signing pair', () => {
    expect(kmsConfigOf(env)).toEqual({
      region: 'us-east-1',
      keyId: arn,
      accessKeyId: 'AKIDFAKEFORTESTS',
      secretAccessKey: 'fake-signing-secret-for-tests-only',
    });
  });

  it.each(['alias/uw-credentials', '1b9c6f0e-0000-4000-8000-000000000157'])(
    'accepts the key named as %s',
    (keyId) => {
      expect(kmsConfigOf({ ...env, CREDENTIALS_KMS_KEY_ID: keyId })?.keyId).toBe(keyId);
    },
  );

  it.each(Object.keys(env))('is not configured without %s', (name) => {
    expect(kmsConfigOf({ ...env, [name]: undefined })).toBeNull();
    expect(kmsConfigOf({ ...env, [name]: '' })).toBeNull();
  });

  it.each([
    ['a region that could change the host', { CREDENTIALS_KMS_REGION: 'us-east-1.evil.example' }],
    ['a region with a path', { CREDENTIALS_KMS_REGION: 'us-east-1/x' }],
    ['a key in another region', { CREDENTIALS_KMS_REGION: 'eu-west-1' }],
    ['a key that is not a KMS key', { CREDENTIALS_KMS_KEY_ID: 'arn:aws:s3:::bucket' }],
    ['an access key id with spaces', { CREDENTIALS_KMS_ACCESS_KEY_ID: 'AKID FAKE' }],
  ])('is not configured with %s', (_name, change) => {
    expect(kmsConfigOf({ ...env, ...change })).toBeNull();
  });
});
