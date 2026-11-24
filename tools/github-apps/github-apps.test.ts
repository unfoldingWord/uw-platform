import { createPublicKey, createVerify, generateKeyPairSync } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { githubApps, manifestOf, REDIRECT_URL } from './apps.ts';
import { appJwt, convertApp, pkcs8Of, type SecretWrite } from './convert.ts';
import { registerPage } from './page.ts';

const pkcs1 = generateKeyPairSync('rsa', { modulusLength: 2048 })
  .privateKey.export({ type: 'pkcs1', format: 'pem' })
  .toString();

function unescaped(text: string): string {
  return text
    .replaceAll('&quot;', '"')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

describe('the register page', () => {
  it('lists every manifest in infra/github', () => {
    const files = readdirSync('infra/github')
      .filter((file) => file.endsWith('.json'))
      .map((file) => `infra/github/${file}`)
      .sort();
    expect(githubApps.map((target) => target.manifest).sort()).toEqual(files);
  });

  it('names each App as its manifest does', () => {
    for (const target of githubApps) expect(manifestOf(target)['name']).toBe(target.slug);
  });

  it('posts each manifest unchanged, plus the redirect, to the org', () => {
    const page = registerPage('state-1');
    const posted = [...page.matchAll(/name="manifest" value="([^"]*)"/g)].map(
      (match) => JSON.parse(unescaped(match[1] ?? '')) as Record<string, unknown>,
    );
    expect(posted).toEqual(
      githubApps.map((target) => ({ ...manifestOf(target), redirect_url: REDIRECT_URL })),
    );
    expect(page).toContain(
      'action="https://github.com/organizations/unfoldingWord/settings/apps/new?state=state-1"',
    );
  });
});

type Call = { readonly url: string; readonly init?: RequestInit };

function fakeGitHub(conversion: Record<string, unknown>, installations: unknown, calls: Call[]) {
  return (url: string, init?: RequestInit): Promise<Response> => {
    calls.push({ url, ...(init === undefined ? {} : { init }) });
    if (url.endsWith('/conversions')) return Promise.resolve(Response.json(conversion));
    return Promise.resolve(Response.json(installations));
  };
}

async function run(conversion: Record<string, unknown>, installations: unknown = []) {
  const calls: Call[] = [];
  const writes: SecretWrite[] = [];
  const lines: string[] = [];
  await convertApp('abc123def', {
    fetch: fakeGitHub(conversion, installations, calls),
    putSecret: (write) => {
      writes.push(write);
      return Promise.resolve();
    },
    nowSeconds: () => 1_800_000_000,
    log: (line) => lines.push(line),
  });
  return { calls, writes, lines };
}

describe('converting a manifest code into Worker secrets', () => {
  it('sets the harness App and its webhook secret on staging only', async () => {
    const { writes, calls } = await run(
      { id: 7, slug: 'uw-harness-staging', pem: pkcs1, webhook_secret: 'hook-secret' },
      [{ id: 99, account: { login: 'unfoldingWord' } }],
    );
    expect(writes.map(({ worker, env, name }) => `${worker} ${env} ${name}`)).toEqual([
      'uw-platform staging GITHUB_APP_ID',
      'uw-platform staging GITHUB_APP_PRIVATE_KEY',
      'uw-platform staging GITHUB_APP_INSTALLATION_ID',
      'uw-ingest staging GITHUB_WEBHOOK_SECRET',
    ]);
    expect(writes[0]?.value).toBe('7');
    expect(writes[1]?.value).toContain('BEGIN PRIVATE KEY');
    expect(writes[2]?.value).toBe('99');
    expect(writes[3]?.value).toBe('hook-secret');
    expect(calls[0]?.url).toBe('https://api.github.com/app-manifests/abc123def/conversions');
  });

  it('sets a shared App on both environments, with no webhook secret', async () => {
    const { writes } = await run({ id: 8, slug: 'uw-builder', pem: pkcs1, webhook_secret: null }, [
      { id: 5, account: { login: 'unfoldingWord' } },
    ]);
    expect(writes.map(({ env, name }) => `${env} ${name}`)).toEqual([
      'staging BUILDER_GITHUB_APP_ID',
      'staging BUILDER_GITHUB_APP_PRIVATE_KEY',
      'staging BUILDER_GITHUB_APP_INSTALLATION_ID',
      'production BUILDER_GITHUB_APP_ID',
      'production BUILDER_GITHUB_APP_PRIVATE_KEY',
      'production BUILDER_GITHUB_APP_INSTALLATION_ID',
    ]);
  });

  it('says how to finish when the App is not installed yet', async () => {
    const { writes, lines } = await run({ id: 9, slug: 'uw-reviewer', pem: pkcs1 });
    expect(writes.map((write) => write.name)).not.toContain('REVIEWER_GITHUB_APP_INSTALLATION_ID');
    expect(lines.join('\n')).toContain('set REVIEWER_GITHUB_APP_INSTALLATION_ID by hand');
  });
});

describe('refusing a code or an App that is not ours', () => {
  it('refuses an App GitHub renamed, and writes nothing', async () => {
    const calls: Call[] = [];
    const writes: SecretWrite[] = [];
    await expect(
      convertApp('abc123def', {
        fetch: fakeGitHub({ id: 1, slug: 'uw-builder-2', pem: pkcs1 }, [], calls),
        putSecret: (write) => {
          writes.push(write);
          return Promise.resolve();
        },
        nowSeconds: () => 0,
        log: () => undefined,
      }),
    ).rejects.toThrow('not one of ours');
    expect(writes).toEqual([]);
  });

  it('refuses something that is not a code', async () => {
    await expect(
      convertApp('../evil', {
        fetch: () => Promise.reject(new Error('no call expected')),
        putSecret: () => Promise.resolve(),
        nowSeconds: () => 0,
        log: () => undefined,
      }),
    ).rejects.toThrow('manifest code');
  });
});

describe('keeping the secrets out of sight', () => {
  it('never logs a secret value', async () => {
    const { lines } = await run(
      { id: 7, slug: 'uw-harness', pem: pkcs1, webhook_secret: 'hook-secret' },
      [{ id: 99, account: { login: 'unfoldingWord' } }],
    );
    const logged = lines.join('\n');
    expect(logged).not.toContain('hook-secret');
    expect(logged).not.toContain('PRIVATE KEY');
  });

  it('signs a JWT GitHub can verify with the App key', () => {
    const pem = pkcs8Of(pkcs1);
    const [header, payload, signature] = appJwt(7, pem, 1_000).split('.');
    const verifier = createVerify('RSA-SHA256');
    verifier.update(`${header}.${payload}`);
    expect(verifier.verify(createPublicKey(pem), signature ?? '', 'base64url')).toBe(true);
    expect(JSON.parse(Buffer.from(payload ?? '', 'base64url').toString())).toEqual({
      iat: 940,
      exp: 1_540,
      iss: '7',
    });
  });

  it('keeps no secret in the tool sources', () => {
    for (const file of ['apps.ts', 'convert.ts', 'page.ts', 'run-convert.ts', 'run-page.ts']) {
      expect(readFileSync(`tools/github-apps/${file}`, 'utf8')).not.toMatch(/BEGIN [A-Z ]*KEY/);
    }
  });
});
