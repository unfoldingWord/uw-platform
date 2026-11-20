import { readFileSync } from 'node:fs';
import { parse } from 'smol-toml';
import { describe, expect, it } from 'vitest';

type Env = { vars?: Record<string, string> };
type Config = { env: Record<string, Env> };

const files = ['infra/uw-app/wrangler.toml', 'infra/uw-app/wrangler.go-live.toml'];
const deployed = ['staging', 'production'] as const;
const sites = files.flatMap((file) => deployed.map((env) => [file, env] as const));
const region = 'us-west-2';
const keyArn =
  /^arn:aws:kms:us-west-2:002723143144:key\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function varsOf(file: string, env: string): Record<string, string> {
  const config = parse(readFileSync(file, 'utf8')) as unknown as Config;
  return config.env[env]?.vars ?? {};
}

function kmsNames(file: string, env: string): string[] {
  return Object.keys(varsOf(file, env)).filter((name) => name.startsWith('CREDENTIALS_KMS_'));
}

describe('#186 each deployed environment names its own KMS key for the credentials store', () => {
  it.each(sites)('%s %s sets the region the keys were created in', (file, env) => {
    expect(varsOf(file, env)['CREDENTIALS_KMS_REGION']).toBe(region);
  });

  it.each(sites)('%s %s names its key by full ARN in that region, never an alias', (file, env) => {
    expect(varsOf(file, env)['CREDENTIALS_KMS_KEY_ID']).toMatch(keyArn);
  });

  it.each(files)('%s gives staging and production different keys', (file) => {
    const keys = deployed.map((env) => varsOf(file, env)['CREDENTIALS_KMS_KEY_ID']);
    expect(new Set(keys).size).toBe(deployed.length);
  });

  it.each(sites)('%s %s declares the access key pair nowhere as a var', (file, env) => {
    expect(kmsNames(file, env).sort()).toEqual([
      'CREDENTIALS_KMS_KEY_ID',
      'CREDENTIALS_KMS_REGION',
    ]);
  });

  it.each(files)('%s gives a preview Worker no KMS setting', (file) => {
    expect(kmsNames(file, 'preview')).toEqual([]);
  });
});
