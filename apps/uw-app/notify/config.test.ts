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

  it('answers null when the public key is not the private key pair', async () => {
    const vapid = await vapidFixture();
    const other = await vapidFixture();
    const mismatched = { ...vapid.env, VAPID_PUBLIC_KEY: other.env.VAPID_PUBLIC_KEY };
    expect(notifyConfigOf(mismatched).push).toBeNull();
    expect(notifyConfigOf(vapid.env).push).not.toBeNull();
  });
});
