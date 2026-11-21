import { readFileSync } from 'node:fs';
import { parse } from 'smol-toml';
import { describe, expect, it } from 'vitest';
import { platformSecretNames } from '../../apps/uw-app/secrets.ts';
import { ingestSecretNames } from '../../apps/uw-ingest/secrets.ts';
import kms from '../../infra/aws/credentials-kms.json' with { type: 'json' };
import inventory from '../../infra/secrets-store.json' with { type: 'json' };

type StoreBinding = {
  readonly binding: string;
  readonly store_id: string;
  readonly secret_name: string;
};
type Block = Record<string, unknown>;
type Listed = (typeof inventory.secrets)[number];
type Environment = (typeof environments)[number];

const apps = ['uw-app', 'uw-ingest'] as const;
const environments = ['staging', 'production'] as const;
const placeholder = 'set-at-go-live';
const live = 'wrangler.toml';
const goLive = 'wrangler.go-live.toml';
const storeIdShape = /^[0-9a-f]{32}$/;
const dateShape = /^\d{4}-\d{2}-\d{2}$/;
const ownerShape = /^[^@\s]+@[^@\s]+$/;
const namedLikeACredential = /API_KEY|TOKEN|SECRET|PRIVATE|ACCESS_KEY/;
const stringBinding = /^\s+([A-Z][A-Z0-9_]*)\?: string;$/gm;
const readers: Readonly<Record<string, readonly string[]>> = {
  'uw-app': platformSecretNames,
  'uw-ingest': ingestSecretNames,
};

function load(app: string, file: string): Block {
  return parse(readFileSync(`infra/${app}/${file}`, 'utf8')) as Block;
}

function environmentOf(config: Block, name: string): Block {
  return ((config['env'] ?? {}) as Record<string, Block>)[name] ?? {};
}

function boundIn(block: Block): StoreBinding[] {
  return (block['secrets_store_secrets'] ?? []) as StoreBinding[];
}

function listedFor(app: string): Listed[] {
  return inventory.secrets.filter((secret) => secret.worker === app);
}

function declaredFor(app: string, environment: Environment, storeId: string): StoreBinding[] {
  return listedFor(app).map((secret) => ({
    binding: `STORE_${secret.name}`,
    store_id: storeId,
    secret_name: `UW_${environment.toUpperCase()}_${secret.name}`,
  }));
}

function byBinding(bindings: readonly StoreBinding[]): StoreBinding[] {
  return [...bindings].sort((a, b) => a.binding.localeCompare(b.binding));
}

function liveFaults(
  bound: readonly StoreBinding[],
  declared: readonly StoreBinding[],
  environment: Environment,
  listed: readonly Listed[],
): string[] {
  return bound.flatMap((entry) => {
    const name = entry.binding.replace(/^STORE_/, '');
    const twin = declared.find((candidate) => candidate.binding === entry.binding);
    const secret = listed.find((candidate) => candidate.name === name);
    return [
      ...(twin === undefined ? [`${entry.binding}: not in the go-live file`] : []),
      ...(twin !== undefined && JSON.stringify(twin) !== JSON.stringify(entry)
        ? [`${entry.binding}: differs from the go-live file`]
        : []),
      ...(storeIdShape.test(entry.store_id) ? [] : [`${entry.binding}: no store id`]),
      ...(secret === undefined || ownerShape.test(secret.owner) ? [] : [`${name}: no owner`]),
      ...(secret === undefined || dateShape.test(secret.rotate_by[environment])
        ? []
        : [`${name}: no rotation date`]),
    ];
  });
}

function goLiveBindings(app: string, name: Environment): StoreBinding[] {
  return boundIn(environmentOf(load(app, goLive), name));
}

function everyStoreId(): string[] {
  const blocks = apps.flatMap((app) => environments.map((name) => goLiveBindings(app, name)));
  return blocks.flat().map((entry) => entry.store_id);
}

function varNamesIn(app: string, file: string): string[] {
  const config = load(app, file);
  const blocks = [config, ...Object.values((config['env'] ?? {}) as Record<string, Block>)];
  return blocks.flatMap((block) => Object.keys((block['vars'] ?? {}) as Block));
}

function keyIdIsDeclared(keyId: string, region: string): boolean {
  if (keyId === placeholder) return true;
  const [prefix, id] = keyId.split(':key/');
  const account = (prefix ?? '').replace(`arn:aws:kms:${region}:`, '');
  return /^[0-9]{12}$/.test(account) && /^[0-9a-f-]{36}$/.test(id ?? '');
}

const planted = {
  declared: [
    { binding: 'STORE_A', store_id: placeholder, secret_name: 'UW_STAGING_A' },
    { binding: 'STORE_B', store_id: placeholder, secret_name: 'UW_STAGING_B' },
  ],
  listed: [
    {
      name: 'A',
      worker: 'uw-app',
      what: 'a',
      issued_by: 'a',
      owner: placeholder,
      rotate_by: { staging: placeholder, production: placeholder },
    },
    {
      name: 'B',
      worker: 'uw-app',
      what: 'b',
      issued_by: 'b',
      owner: 'owner@example.org',
      rotate_by: { staging: '2027-05-01', production: placeholder },
    },
  ],
  bound: [
    { binding: 'STORE_A', store_id: placeholder, secret_name: 'UW_STAGING_A' },
    { binding: 'STORE_B', store_id: '0123456789abcdef0123456789abcdef', secret_name: 'B' },
    { binding: 'STORE_C', store_id: '0123456789abcdef0123456789abcdef', secret_name: 'C' },
  ],
};

function stringBindingsIn(file: string): string[] {
  return [...readFileSync(file, 'utf8').matchAll(stringBinding)].map((match) => match[1] ?? '');
}

describe('#160 every platform secret is listed under 30-39 Infrastructure with an owner and a rotation date', () => {
  it('lists the secrets under 30-39', () => {
    expect(inventory.area).toBe('30-39');
  });

  it.each(apps)('%s reads exactly the secrets the list gives it', (app) => {
    expect(listedFor(app).map((secret) => secret.name)).toEqual([...(readers[app] ?? [])].sort());
  });

  it.each([
    ['uw-app', 'apps/uw-app/env.ts'],
    ['uw-ingest', 'apps/uw-ingest/env.ts'],
  ])('%s has no binding named like a credential that the list leaves out', (app, file) => {
    const secretLike = stringBindingsIn(file).filter((name) => namedLikeACredential.test(name));
    expect(secretLike.length).toBeGreaterThan(0);
    expect(secretLike.filter((name) => !(readers[app] ?? []).includes(name))).toEqual([]);
  });

  it('gives each secret an owner and a rotation date per environment, or says they are still to set', () => {
    for (const secret of inventory.secrets) {
      expect(secret.owner === placeholder || ownerShape.test(secret.owner), secret.name).toBe(true);
      for (const environment of environments) {
        const date = secret.rotate_by[environment];
        expect(date === placeholder || dateShape.test(date), secret.name).toBe(true);
      }
      expect(secret.what.length, secret.name).toBeGreaterThan(0);
    }
  });

  it('stays under the Secrets Store limit of 100 secrets for the account', () => {
    expect(inventory.secrets.length * environments.length).toBeLessThanOrEqual(100);
  });
});

describe('#160 each Worker binds only the secrets it reads, declared in infra', () => {
  it.each(apps.flatMap((app) => environments.map((name) => [app, name] as const)))(
    '%s %s go-live file binds exactly its listed secrets, one store, one name per environment',
    (app, name) => {
      const bound = goLiveBindings(app, name);
      const storeId = bound[0]?.store_id ?? '';
      expect(storeId === placeholder || storeIdShape.test(storeId)).toBe(true);
      expect(byBinding(bound)).toEqual(byBinding(declaredFor(app, name, storeId)));
    },
  );

  it.each(apps)('%s binds no secret at the top level or in preview', (app) => {
    for (const file of [live, goLive]) {
      const config = load(app, file);
      expect(boundIn(config)).toEqual([]);
      expect(boundIn(environmentOf(config, 'preview'))).toEqual([]);
    }
  });

  it('uw-ingest binds none of uw-app’s secrets and uw-app none of uw-ingest’s', () => {
    const app = goLiveBindings('uw-app', 'production').map((entry) => entry.secret_name);
    const ingest = goLiveBindings('uw-ingest', 'production');
    expect(ingest.filter((entry) => app.includes(entry.secret_name))).toEqual([]);
    expect(ingest.map((entry) => entry.binding)).toEqual([
      'STORE_GITHUB_WEBHOOK_SECRET',
      'STORE_ZULIP_WEBHOOK_TOKEN',
    ]);
  });

  it('uses one store id everywhere', () => {
    expect(new Set(everyStoreId()).size).toBe(1);
  });

  it('declares no listed secret as a var in any wrangler file', () => {
    const names = new Set(inventory.secrets.map((secret) => secret.name));
    const declared = apps.flatMap((app) => [...varNamesIn(app, live), ...varNamesIn(app, goLive)]);
    expect(declared.filter((name) => names.has(name))).toEqual([]);
  });
});

describe('#160 a secret is bound in the live file only once it was moved', () => {
  it.each(apps.flatMap((app) => environments.map((name) => [app, name] as const)))(
    '%s %s live file binds only secrets in the go-live file, with a store id, an owner and a rotation date',
    (app, name) => {
      const bound = boundIn(environmentOf(load(app, live), name));
      expect(liveFaults(bound, goLiveBindings(app, name), name, listedFor(app))).toEqual([]);
    },
  );

  it('flags a live binding that is not declared, has no store id, or has no owner or rotation date', () => {
    const { bound, declared, listed } = planted;
    expect(liveFaults(bound, declared, 'staging', listed)).toEqual([
      'STORE_A: no store id',
      'A: no owner',
      'A: no rotation date',
      'STORE_B: differs from the go-live file',
      'STORE_C: not in the go-live file',
    ]);
    expect(liveFaults([], declared, 'staging', listed)).toEqual([]);
  });
});

describe('#160 the Worker that opens credentials may only wrap and unwrap under its one KMS key', () => {
  it('allows kms:Decrypt and kms:GenerateDataKey on one key and nothing else', () => {
    expect(kms.policy.Statement).toHaveLength(1);
    const [statement] = kms.policy.Statement;
    expect(statement?.Effect).toBe('Allow');
    expect(statement?.Action).toEqual(['kms:Decrypt', 'kms:GenerateDataKey']);
    expect(statement?.Resource).toBe('<key-arn>');
    expect(JSON.stringify(kms.policy)).not.toContain('*');
  });

  it.each(environments)('%s declares the region the Worker is given and one key', (name) => {
    const vars = (environmentOf(load('uw-app', live), name)['vars'] ?? {}) as Block;
    expect(vars['CREDENTIALS_KMS_REGION']).toBe(kms.region);
    expect(Object.keys(kms.environments)).toEqual([...environments]);
    expect(keyIdIsDeclared(String(vars['CREDENTIALS_KMS_KEY_ID']), kms.region)).toBe(true);
  });

  it('accepts a key ARN in the declared region and refuses one elsewhere', () => {
    const id = '0a1b2c3d-0a1b-0a1b-0a1b-0a1b2c3d4e5f';
    expect(keyIdIsDeclared(`arn:aws:kms:us-west-2:123456789012:key/${id}`, 'us-west-2')).toBe(true);
    expect(keyIdIsDeclared(`arn:aws:kms:eu-west-1:123456789012:key/${id}`, 'us-west-2')).toBe(
      false,
    );
    expect(keyIdIsDeclared('alias/anything', 'us-west-2')).toBe(false);
  });
});

describe('#160 the runbook moves the secrets without ever writing a value', () => {
  const readme = readFileSync('infra/README.md', 'utf8');
  const heading = '## Platform secrets in Cloudflare Secrets Store (#160)';
  const section = readme.slice(readme.indexOf(heading)).split('\n## ')[0] ?? '';

  it('has its section and lists every secret in it', () => {
    expect(readme).toContain(heading);
    const missing = inventory.secrets.filter((secret) => !section.includes(`\`${secret.name}\``));
    expect(missing).toEqual([]);
  });

  it('never passes a value on a command line', () => {
    expect(readme).not.toContain('--value');
  });

  it('takes staging before production and says how to verify and how to roll back', () => {
    const staging = section.indexOf('### Move staging');
    const production = section.indexOf('### Move production');
    expect(staging).toBeGreaterThan(-1);
    expect(production).toBeGreaterThan(staging);
    expect(section).toContain('### Roll back');
    expect(section).toContain('select(.name == "secrets")');
    expect(section).toContain('wrangler secrets-store secret create');
  });
});
