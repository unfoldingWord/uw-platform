import type { Bindings } from '../../env.ts';
import type { KmsConfig } from './aws.ts';

type KmsEnv = Pick<
  Bindings,
  | 'CREDENTIALS_KMS_REGION'
  | 'CREDENTIALS_KMS_KEY_ID'
  | 'CREDENTIALS_KMS_ACCESS_KEY_ID'
  | 'CREDENTIALS_KMS_SECRET_ACCESS_KEY'
>;

const regionWord = /^[a-z]+$/;
const regionNumber = /^[0-9]$/;
const keyArnPattern = /^arn:aws[a-z-]*:kms:([a-z0-9-]+):[0-9]{12}:(?:key|alias)\/[A-Za-z0-9/_-]+$/;
const keyAliasPattern = /^alias\/[A-Za-z0-9/_-]+$/;
const keyUuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const accessKeyIdPattern = /^[A-Z0-9]{16,128}$/;
const SECRET_MAX = 200;

function isRegion(region: string): boolean {
  const parts = region.split('-');
  const words = parts.slice(0, -1);
  if (words.length < 2 || words.length > 3 || words.at(0)?.length !== 2) return false;
  return words.every((word) => regionWord.test(word)) && regionNumber.test(parts.at(-1) ?? '');
}

function keyIn(region: string, keyId: string): boolean {
  const arn = keyArnPattern.exec(keyId);
  if (arn !== null) return arn[1] === region;
  return keyAliasPattern.test(keyId) || keyUuidPattern.test(keyId);
}

export function kmsConfigOf(env: KmsEnv): KmsConfig | null {
  const region = env.CREDENTIALS_KMS_REGION ?? '';
  const keyId = env.CREDENTIALS_KMS_KEY_ID ?? '';
  const accessKeyId = env.CREDENTIALS_KMS_ACCESS_KEY_ID ?? '';
  const secretAccessKey = env.CREDENTIALS_KMS_SECRET_ACCESS_KEY ?? '';
  if (!isRegion(region) || !keyIn(region, keyId)) return null;
  if (!accessKeyIdPattern.test(accessKeyId)) return null;
  if (secretAccessKey.length < 1 || secretAccessKey.length > SECRET_MAX) return null;
  return { region, keyId, accessKeyId, secretAccessKey };
}
