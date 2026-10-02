import { Hono } from 'hono';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AppEnv } from '../deps.ts';
import { systemClock } from '../ports/clock.ts';
import {
  createAccessFixture,
  fixtureAccessEnv,
  type AccessFixture,
} from '../testing/access-keys.ts';
import { withPrincipal } from './principal-middleware.ts';

let fixture: AccessFixture;

beforeAll(async () => {
  fixture = await createAccessFixture();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function requestInstant(token: string): Promise<Response> {
  const app = new Hono<AppEnv>()
    .use(withPrincipal({ accessKeys: () => fixture.keys, clock: systemClock }))
    .get('/', (c) => c.text(c.get('now').toISOString()));
  return Promise.resolve(
    app.request('/', { headers: { 'cf-access-jwt-assertion': token } }, fixtureAccessEnv),
  );
}

describe('FD-7 DX-1 the request instant comes from the platform clock', () => {
  it('stamps the request with the Clock port instant, not a second clock', async () => {
    vi.spyOn(systemClock, 'now').mockReturnValue(new Date('2031-02-03T04:05:06.000Z'));
    const response = await requestInstant(await fixture.sign({ common_name: 'a1b2c3d4.access' }));
    expect(await response.text()).toBe('2031-02-03T04:05:06.000Z');
  });
});
