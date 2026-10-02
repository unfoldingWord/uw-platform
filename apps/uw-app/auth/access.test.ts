import { createLocalJWKSet, errors, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import { refusalSchema } from '@uw/contracts';
import { createApp } from '../app.tsx';
import type { Bindings } from '../env.ts';
import {
  createAccessFixture,
  fixtureAccessEnv,
  type AccessFixture,
} from '../testing/access-keys.ts';
import { recordingDeps } from '../testing/deps.ts';

const person = { email: 'Ada@Example.org' };
const service = { common_name: 'a1b2c3d4.access' };

let fixture: AccessFixture;

beforeAll(async () => {
  fixture = await createAccessFixture();
});

function base64url(value: unknown): string {
  return btoa(JSON.stringify(value)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function call(path: string, token?: string, env: Bindings = fixtureAccessEnv) {
  const { deps, lines } = recordingDeps();
  const app = createApp({ ...deps, accessKeys: () => fixture.keys });
  const headers: Record<string, string> = token ? { 'cf-access-jwt-assertion': token } : {};
  return {
    lines,
    response: app.request(path, { headers }, env),
  };
}

async function expectRefusal(token: string | undefined, status: number, reason: string) {
  const response = await call('/', token).response;
  expect(response.status).toBe(status);
  const body = refusalSchema.parse(await response.json());
  expect(body.reason).toBe(reason);
}

function tamper(token: string): string {
  const [header, payload, signature] = token.split('.');
  const flipped = payload?.startsWith('A')
    ? `B${payload.slice(1)}`
    : `A${(payload ?? '').slice(1)}`;
  return [header, flipped, signature].join('.');
}

describe('FD-7 the Access JWT is verified on every request', () => {
  it('serves /health with no token and no Access configuration', async () => {
    const response = await call('/health', undefined, {}).response;
    expect(response.status).toBe(200);
  });

  it('refuses every other route when Access is not configured', async () => {
    const response = await call('/', await fixture.sign(person), {}).response;
    expect(response.status).toBe(503);
    expect(refusalSchema.parse(await response.json()).reason).toBe('access_not_configured');
  });

  it('refuses a team domain that is not a cloudflareaccess.com origin', async () => {
    const response = await call('/', await fixture.sign(person), {
      ...fixtureAccessEnv,
      ACCESS_TEAM_DOMAIN: 'https://evil.example.com',
    }).response;
    expect(response.status).toBe(503);
    expect(refusalSchema.parse(await response.json()).reason).toBe('access_not_configured');
  });

  it('refuses a request with no token', async () => {
    await expectRefusal(undefined, 401, 'unauthenticated');
  });

  it('accepts a valid person token and stops at the missing database', async () => {
    await expectRefusal(await fixture.sign(person), 503, 'database_not_configured');
  });

  it('turns a valid service token on /mcp into a non-interactive agent principal', async () => {
    const { response, lines } = call('/mcp', await fixture.signForMcp(service));
    expect((await response).status).toBe(503);
    expect(lines.at(-1)).toMatchObject({ principal: 'agent:svc-a1b2c3d4-access' });
  });
});

describe('FD-7 a token that does not verify gets 401', () => {
  it('refuses a token with a changed payload', async () => {
    await expectRefusal(tamper(await fixture.sign(person)), 401, 'unauthenticated');
  });

  it('refuses an expired token', async () => {
    const expiresAt = Math.floor(Date.now() / 1000) - 60;
    await expectRefusal(await fixture.sign(person, { expiresAt }), 401, 'unauthenticated');
  });

  it('refuses a token for another audience', async () => {
    const token = await fixture.sign(person, { audience: 'someone-else' });
    await expectRefusal(token, 401, 'unauthenticated');
  });

  it('refuses a token from another issuer', async () => {
    const token = await fixture.sign(person, { issuer: 'https://evil.cloudflareaccess.com' });
    await expectRefusal(token, 401, 'unauthenticated');
  });

  it('refuses an unsigned alg none token', async () => {
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      ...person,
      iss: fixtureAccessEnv.ACCESS_TEAM_DOMAIN,
      aud: fixtureAccessEnv.ACCESS_AUD,
      exp: now + 300,
    };
    const token = `${base64url({ alg: 'none', typ: 'JWT' })}.${base64url(payload)}.`;
    await expectRefusal(token, 401, 'unauthenticated');
  });

  it('refuses a token signed with HS256', async () => {
    const token = await new SignJWT(person)
      .setProtectedHeader({ alg: 'HS256', kid: 'fixture' })
      .setIssuer(fixtureAccessEnv.ACCESS_TEAM_DOMAIN)
      .setAudience(fixtureAccessEnv.ACCESS_AUD)
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode('fixture'));
    await expectRefusal(token, 401, 'unauthenticated');
  });

  it('refuses a token with neither email nor common_name', async () => {
    await expectRefusal(await fixture.sign({}), 401, 'unauthenticated');
  });
});

async function twoKeySetAndKidlessToken() {
  const first = await generateKeyPair('RS256', { extractable: true });
  const second = await generateKeyPair('RS256', { extractable: true });
  const jwks = {
    keys: [
      { ...(await exportJWK(first.publicKey)), alg: 'RS256' },
      { ...(await exportJWK(second.publicKey)), alg: 'RS256' },
    ],
  };
  const token = await new SignJWT(person)
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer(fixtureAccessEnv.ACCESS_TEAM_DOMAIN)
    .setAudience(fixtureAccessEnv.ACCESS_AUD)
    .setExpirationTime('5m')
    .sign(first.privateKey);
  return { keys: createLocalJWKSet(jwks), token };
}

describe('FD-7 a token jose cannot select a key for or does not support gets 401', () => {
  it('refuses a token whose header names an unrecognised critical parameter', async () => {
    const [, payload, signature] = (await fixture.sign(person)).split('.');
    const header = base64url({ alg: 'RS256', kid: 'fixture', crit: ['x'], x: 1 });
    await expectRefusal(`${header}.${payload}.${signature}`, 401, 'unauthenticated');
  });

  it('refuses a token with no kid against a key set holding two matching keys', async () => {
    const { keys, token } = await twoKeySetAndKidlessToken();
    const { deps } = recordingDeps();
    const response = await createApp({ ...deps, accessKeys: () => keys }).request(
      '/',
      { headers: { 'cf-access-jwt-assertion': token } },
      fixtureAccessEnv,
    );
    expect(response.status).toBe(401);
    expect(refusalSchema.parse(await response.json()).reason).toBe('unauthenticated');
  });
});

describe('FD-7 expiry is required and identity claims are constrained', () => {
  it('refuses a signed token that carries no expiry', async () => {
    const token = await fixture.sign(person, { expiresAt: null });
    await expectRefusal(token, 401, 'unauthenticated');
  });

  it('treats an empty email as absent and yields the service-token principal', async () => {
    const { response, lines } = call('/mcp', await fixture.signForMcp({ email: '', ...service }));
    expect((await response).status).toBe(503);
    expect(lines.at(-1)).toMatchObject({ principal: 'agent:svc-a1b2c3d4-access' });
  });

  it('refuses a common_name that cannot name an agent identity', async () => {
    await expectRefusal(await fixture.sign({ common_name: '___' }), 401, 'unauthenticated');
  });

  it('maps a token with both email and common_name to the person', async () => {
    const token = await fixture.sign({ ...person, ...service });
    await expectRefusal(token, 503, 'database_not_configured');
  });

  it('answers 500 internal_error and logs an error when the key set cannot be fetched', async () => {
    const { deps, lines } = recordingDeps();
    const failing = {
      ...deps,
      accessKeys: () => async () => {
        throw new errors.JWKSTimeout();
      },
    };
    const token = await fixture.sign(person);
    const response = await createApp(failing).request(
      '/',
      { headers: { 'cf-access-jwt-assertion': token } },
      fixtureAccessEnv,
    );
    expect(response.status).toBe(500);
    expect(refusalSchema.parse(await response.json()).reason).toBe('internal_error');
    expect(lines.map((line) => line['level'])).toContain('error');
  });
});

async function refusalOn(path: string, token: string, method = 'GET', env = fixtureAccessEnv) {
  const { deps } = recordingDeps();
  const app = createApp({ ...deps, accessKeys: () => fixture.keys });
  const headers = { 'cf-access-jwt-assertion': token, 'x-uw-device': 'laptop' };
  const response = await app.request(path, { method, headers }, env);
  return [response.status, refusalSchema.parse(await response.json()).reason];
}

describe('AB-1 FD-7 each Access application is accepted only on its own paths', () => {
  it('refuses an app-audience person token on /mcp', async () => {
    expect(await refusalOn('/mcp', await fixture.sign(person), 'POST')).toEqual([
      401,
      'unauthenticated',
    ]);
  });

  it('refuses an mcp-audience person token on /api/* and on the app root', async () => {
    const token = await fixture.signForMcp(person);
    expect(await refusalOn('/api/acl/commands/grant_role', token, 'POST')).toEqual([
      401,
      'unauthenticated',
    ]);
    expect(await refusalOn('/api/me', token)).toEqual([401, 'unauthenticated']);
    expect(await refusalOn('/', token)).toEqual([401, 'unauthenticated']);
  });

  it('accepts an mcp-audience token on /mcp and stops at the missing database', async () => {
    expect(await refusalOn('/mcp', await fixture.signForMcp(person), 'POST')).toEqual([
      503,
      'database_not_configured',
    ]);
    expect(await refusalOn('/mcp', await fixture.signForMcp(service), 'POST')).toEqual([
      503,
      'database_not_configured',
    ]);
  });

  it('refuses a service token on /api/*, whichever audience it carries', async () => {
    for (const token of [await fixture.signForMcp(service), await fixture.sign(service)]) {
      expect(await refusalOn('/api/pages', token)).toEqual([401, 'unauthenticated']);
      expect(await refusalOn('/api/agents/commands/bind_service_token', token, 'POST')).toEqual([
        401,
        'unauthenticated',
      ]);
    }
  });

  it('refuses /mcp when the mcp audience is not configured', async () => {
    const env = { ...fixtureAccessEnv, ACCESS_MCP_AUD: '' };
    expect(await refusalOn('/mcp', await fixture.signForMcp(person), 'POST', env)).toEqual([
      503,
      'access_not_configured',
    ]);
  });
});
