import { describe, expect, it } from 'vitest';
import { assistantZulipConfigOf } from './config.ts';

const env = {
  ZULIP_SITE: 'https://chat.example.org',
  ASSISTANT_WEBHOOK_BASE: 'https://ingest.example.org',
  ZULIP_ADMIN_EMAIL: 'platform-admin@example.org',
  ZULIP_ADMIN_API_KEY: 'admin-key',
};

describe('PA-6 the assistant Zulip configuration', () => {
  it('points every bot at the uw-ingest assistant webhook and signs in as the service admin', () => {
    expect(assistantZulipConfigOf(env)).toEqual({
      admin: {
        site: 'https://chat.example.org',
        email: 'platform-admin@example.org',
        apiKey: 'admin-key',
      },
      webhookUrl: 'https://ingest.example.org/webhooks/zulip-assistant',
    });
  });

  it.each([
    { ...env, ZULIP_SITE: 'set-at-go-live' },
    { ...env, ASSISTANT_WEBHOOK_BASE: 'http://ingest.example.org' },
    { ...env, ZULIP_ADMIN_EMAIL: 'set-at-go-live' },
    { ...env, ZULIP_ADMIN_API_KEY: '' },
  ])('is off until every value is set: %j', (partial) => {
    expect(assistantZulipConfigOf(partial)).toBeNull();
  });
});
