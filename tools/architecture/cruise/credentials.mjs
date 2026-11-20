import { npm, testFile } from './shared.mjs';

const kmsClient = '^apps/uw-app/credentials/kms/';

export const credentialRules = [
  {
    name: 'aws-signer-only-in-the-kms-client',
    comment:
      'The AWS request signer is imported only by the KMS client in apps/uw-app/credentials/kms/, so no other module signs a request with the key-encryption credentials.',
    severity: 'error',
    from: { pathNot: [kmsClient, testFile] },
    to: { path: npm('aws4fetch') },
  },
  {
    name: 'kms-client-only-in-the-credentials-store',
    comment:
      'Only the credentials store reaches the KMS client, so a data key is wrapped and unwrapped in one place.',
    severity: 'error',
    from: { pathNot: ['^apps/uw-app/credentials/', testFile] },
    to: { path: kmsClient },
  },
];
