import { describe, expect, it } from 'vitest';
import { githubAppOf } from './app-config.ts';

const secrets = {
  GITHUB_APP_ID: '4242',
  GITHUB_APP_INSTALLATION_ID: '77',
  GITHUB_APP_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\nfixture\n-----END PRIVATE KEY-----',
};

describe('the GitHub App configuration comes from the three Worker secrets', () => {
  it('is absent when no secret is set, so nothing needs them to run', () => {
    expect(githubAppOf({})).toBeNull();
  });

  it.each(Object.keys(secrets))('is absent while %s is missing or empty', (name) => {
    expect(githubAppOf({ ...secrets, [name]: undefined })).toBeNull();
    expect(githubAppOf({ ...secrets, [name]: '' })).toBeNull();
  });

  it('carries the three values when all are set', () => {
    expect(githubAppOf(secrets)).toEqual({
      appId: '4242',
      installationId: '77',
      privateKey: secrets.GITHUB_APP_PRIVATE_KEY,
    });
  });
});
