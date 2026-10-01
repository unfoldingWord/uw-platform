import { SignJWT } from 'jose';
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
  });

  it('refuses a request with no token', async () => {
    await expectRefusal(undefined, 401, 'unauthenticated');
  });

  it('accepts a valid person token and stops at the missing database', async () => {
    await expectRefusal(await fixture.sign(person), 503, 'database_not_configured');
  });

  it('turns a valid service token into a non-interactive agent principal', async () => {
    const { response, lines } = call('/', await fixture.sign(service));
    expect((await response).status).toBe(200);
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
