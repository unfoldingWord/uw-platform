import { describe, expect, it } from 'vitest';
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
