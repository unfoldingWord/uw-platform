import { readFileSync } from 'node:fs';
import { parse } from 'smol-toml';
import { describe, expect, it } from 'vitest';
import { ASSISTANT_JD_CATEGORY } from '../../packages/contracts/assistant-accounts.ts';
import { ASSISTANTS_AREA } from '../../apps/uw-platform/assistants/area.ts';
import { platformSecretNames } from '../../apps/uw-platform/secrets.ts';
import inventory from '../../infra/secrets-store.json' with { type: 'json' };

type Block = Record<string, unknown>;
type StoreBinding = { readonly binding: string; readonly secret_name: string };

const placeholder = 'set-at-go-live';
const files = ['wrangler.toml', 'wrangler.go-live.toml'] as const;
const environments = ['staging', 'production'] as const;
const emailShape = /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/;
const originShape = /^https:\/\/[a-z0-9.-]+$/;

const assistantVariables: Readonly<Record<string, (value: string, env: string) => boolean>> = {
  ZULIP_SITE: (value) => value === placeholder || originShape.test(value),
  ZULIP_ADMIN_EMAIL: (value) => value === placeholder || emailShape.test(value),
  ASSISTANT_WEBHOOK_BASE: (value) => value === placeholder || originShape.test(value),
  GOOGLE_WORKSPACE_DOMAIN: (value) => value === 'unfoldingword.org',
  GOOGLE_WORKSPACE_ADMIN_SUBJECT: (value) =>
    value === placeholder || (emailShape.test(value) && value.endsWith('@unfoldingword.org')),
  GOOGLE_ASSISTANT_OU: (value) => /^\/[A-Za-z0-9 ._/-]+$/.test(value),
  ASSISTANT_EMAIL_INSTRUCTIONS: (value, env) =>
    env === 'production' ? value === 'off' : value === 'on' || value === 'off',
  ASSISTANT_SPEND_CAP_MINOR: (value) => value === '' || /^[1-9]\d{0,14}$/.test(value),
  APP_ORIGIN: (value) => originShape.test(value),
  ALWAYS_ON_MODEL: (value) => value.length > 0,
  ALWAYS_ON_PROVIDER: (value) => value.length > 0,
};
const assistantSecrets = [
  'GOOGLE_WORKSPACE_KEY',
  'ZULIP_ADMIN_API_KEY',
  'CREDENTIALS_KMS_ACCESS_KEY_ID',
  'CREDENTIALS_KMS_SECRET_ACCESS_KEY',
  'OPENROUTER_API_KEY',
];

function environmentOf(file: string, name: string): Block {
  const config = parse(readFileSync(`infra/uw-platform/${file}`, 'utf8')) as Block;
  return ((config['env'] ?? {}) as Record<string, Block>)[name] ?? {};
}

function varsOf(block: Block): Record<string, string> {
  return (block['vars'] ?? {}) as Record<string, string>;
}

function faultsIn(file: string, env: string): string[] {
  const vars = varsOf(environmentOf(file, env));
  return Object.entries(assistantVariables).flatMap(([name, valid]) => {
    const value = vars[name];
    if (value === undefined) return [`${file} ${env}: ${name} is not declared`];
    return valid(value, env) ? [] : [`${file} ${env}: ${name} = "${value}" is malformed`];
  });
}

function boundIn(env: string): readonly StoreBinding[] {
  const block = environmentOf('wrangler.go-live.toml', env);
  return (block['secrets_store_secrets'] ?? []) as StoreBinding[];
}

function secretFaults(name: string): string[] {
  const listed = inventory.secrets.some(
    (secret) => secret.worker === 'uw-platform' && secret.name === name,
  );
  const read = (platformSecretNames as readonly string[]).includes(name);
  const unbound = environments.filter(
    (env) => !boundIn(env).some((entry) => entry.secret_name === `UW_${env.toUpperCase()}_${name}`),
  );
  return [
    ...(listed ? [] : [`${name}: not in the inventory`]),
    ...(read ? [] : [`${name}: not read`]),
    ...unbound.map((env) => `${name}: not bound in ${env}`),
  ];
}

describe('go-live: every setting the assistants read is declared for staging and production', () => {
  it.each(files)(
    '%s declares each assistant variable, well formed, in both environments',
    (file) => {
      expect(environments.flatMap((env) => faultsIn(file, env))).toEqual([]);
    },
  );

  it('declares each assistant variable as a Worker binding', () => {
    const bindings = readFileSync('apps/uw-platform/env.ts', 'utf8');
    const undeclared = [...Object.keys(assistantVariables), ...assistantSecrets].filter(
      (name) => !bindings.includes(`  ${name}?: string;`),
    );
    expect(undeclared).toEqual([]);
  });

  it('lists each assistant secret, binds it from the store in both environments, and reads it', () => {
    expect(assistantSecrets.flatMap(secretFaults)).toEqual([]);
  });

  it('keeps production email instructions off until the DMARC probe passes', () => {
    for (const file of files) {
      expect(varsOf(environmentOf(file, 'production'))['ASSISTANT_EMAIL_INSTRUCTIONS']).toBe('off');
    }
  });

  it('takes the assistants area from the numbering the contracts fix, not from a deploy variable', () => {
    expect(ASSISTANTS_AREA).toBe(`${ASSISTANT_JD_CATEGORY}-${ASSISTANT_JD_CATEGORY.slice(0, 1)}9`);
    for (const file of files) {
      for (const env of environments) {
        expect(varsOf(environmentOf(file, env))).not.toHaveProperty('ASSISTANTS_AREA');
      }
    }
  });
});
