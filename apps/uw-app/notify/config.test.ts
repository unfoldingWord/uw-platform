import { describe, expect, it } from 'vitest';
import { notifyConfigOf } from './config.ts';
import { vapidFixture } from './testing.ts';

describe('the notifier configuration', () => {
  it('reads a complete VAPID configuration and an https app origin', async () => {
    const vapid = await vapidFixture();
    const config = notifyConfigOf({ ...vapid.env, APP_ORIGIN: 'https://app.example.org' });
    expect(config.appOrigin).toBe('https://app.example.org');
    expect(config.push?.publicKey).toBe(vapid.config.publicKey);
    expect(config.push?.privateJwk.d).toBe(vapid.config.privateJwk.d);
  });

  it('answers null for any missing or malformed piece and never throws', async () => {
    const vapid = await vapidFixture();
    const broken = [
      {},
      { ...vapid.env, VAPID_PUBLIC_KEY: 'short' },
      { ...vapid.env, VAPID_SUBJECT: 'http://example.org' },
      { ...vapid.env, VAPID_PRIVATE_JWK: '{' },
      { ...vapid.env, VAPID_PRIVATE_JWK: JSON.stringify({ kty: 'RSA' }) },
    ];
    for (const env of broken) expect(notifyConfigOf(env).push).toBeNull();
    for (const origin of ['http://app.example.org', 'https://app.example.org/path', 'nonsense']) {
      expect(notifyConfigOf({ APP_ORIGIN: origin }).appOrigin).toBeNull();
    }
  });
});
