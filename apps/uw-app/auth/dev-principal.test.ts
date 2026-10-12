import { describe, expect, it } from 'vitest';
import { refusalSchema } from '@uw/contracts';
import { createApp } from '../app.tsx';
import { recordingDeps } from '../testing/deps.ts';
import { fixtureAccessEnv } from '../testing/access-keys.ts';
import { devEmail } from './dev-principal.ts';

const dev = { DEV_PRINCIPAL_EMAIL: 'dev@unfoldingword.org' };

describe('P21 the dev-only principal', () => {
  it('uses DEV_PRINCIPAL_EMAIL on localhost when Access is not configured', () => {
    expect(devEmail(dev, 'http://localhost/')).toBe('dev@unfoldingword.org');
    expect(devEmail(dev, 'http://127.0.0.1:8787/')).toBe('dev@unfoldingword.org');
  });

  it('ignores it on any other host', () => {
    expect(devEmail(dev, 'https://uw-app-staging.unfoldingword.workers.dev/')).toBeNull();
  });

  it('ignores it whenever Access is configured', () => {
    expect(devEmail({ ...fixtureAccessEnv, ...dev }, 'http://localhost/')).toBeNull();
  });
});

describe('P21 FD-7 the dev-only principal through the middleware', () => {
  it('refuses access_not_configured on a non-localhost host even with DEV_PRINCIPAL_EMAIL set', async () => {
    const { deps } = recordingDeps();
    const response = await createApp(deps).request(
      'https://uw-app-staging.unfoldingword.workers.dev/api/me',
      {},
      dev,
    );
    expect(response.status).toBe(503);
    expect(refusalSchema.parse(await response.json()).reason).toBe('access_not_configured');
  });
});
