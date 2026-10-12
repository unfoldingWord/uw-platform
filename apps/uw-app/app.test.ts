import { describe, expect, it } from 'vitest';
import { createApp } from './app.tsx';
import { createAccessFixture, fixtureAccessEnv } from './testing/access-keys.ts';
import { recordingDeps } from './testing/deps.ts';

const commit = '0123456789abcdef0123456789abcdef01234567';

describe('uw-app shell', () => {
  it('reports the deployed commit on the health route', async () => {
    const response = await createApp(recordingDeps().deps).request(
      '/health/probe',
      {},
      { COMMIT_SHA: commit },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'ok', commit });
  });

  it('reports an unknown commit when none was deployed', async () => {
    const response = await createApp(recordingDeps().deps).request('/health/probe', {}, {});
    expect(await response.json()).toMatchObject({ status: 'ok', commit: 'unknown' });
  });
});

const failureMarker = 'jwks-endpoint-marker-7c2e';

async function failingRequest() {
  const { deps, lines } = recordingDeps();
  const fixture = await createAccessFixture();
  const token = await fixture.sign({ email: 'ada@example.org' });
  const failing = {
    ...deps,
    accessKeys: () => async () => {
      throw new RangeError(failureMarker);
    },
  };
  const response = await createApp(failing).request(
    '/',
    { headers: { 'cf-access-jwt-assertion': token } },
    fixtureAccessEnv,
  );
  return { response, lines };
}

describe('FD-11 an unexpected failure is diagnosable from the log alone', () => {
  it('logs the error name and message on the request-failed line', async () => {
    const { lines } = await failingRequest();
    expect(lines).toContainEqual(
      expect.objectContaining({
        level: 'error',
        message: 'request failed',
        error_name: 'RangeError',
        error_message: failureMarker,
      }),
    );
  });

  it('never puts the error in the response', async () => {
    const { response } = await failingRequest();
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain(failureMarker);
  });
});
