import { describe, expect, it } from 'vitest';
import {
  AccessTokenError,
  accessTokensConfigOf,
  createAccessServiceToken,
  deleteAccessServiceToken,
  durationUntil,
  type AccessTokensConfig,
} from './access-tokens.ts';

type Sent = { readonly url: string; readonly init: RequestInit | undefined };

function configAnswering(response: Response, sent: Sent[]): AccessTokensConfig {
  return {
    accountId: 'account-1',
    apiToken: 'key-1',
    fetch: async (input, init) => {
      sent.push({ url: String(input), init });
      return response;
    },
  };
}

describe('the Cloudflare Access service token client', () => {
  it('is switched off until both the account and the key are set', () => {
    const fetcher: typeof fetch = () => Promise.reject(new Error('unused'));
    expect(accessTokensConfigOf({}, fetcher)).toBeNull();
    expect(accessTokensConfigOf({ ACCESS_ACCOUNT_ID: 'account-1' }, fetcher)).toBeNull();
    const env = { ACCESS_ACCOUNT_ID: 'account-1', ACCESS_SERVICE_TOKENS_API_TOKEN: 'key-1' };
    expect(accessTokensConfigOf(env, fetcher)).toMatchObject({ accountId: 'account-1' });
  });

  it('makes a token with a name and a duration and returns its secret', async () => {
    const sent: Sent[] = [];
    const result = { id: 'cf-1', client_id: 'made.access', client_secret: 'secret-1' };
    const config = configAnswering(Response.json({ success: true, result }), sent);
    const made = await createAccessServiceToken(config, 'uw routine laptop', '720h');
    expect(made).toEqual({ id: 'cf-1', clientId: 'made.access', clientSecret: 'secret-1' });
    expect(sent[0]?.url).toBe(
      'https://api.cloudflare.com/client/v4/accounts/account-1/access/service_tokens',
    );
    expect(sent[0]?.init?.method).toBe('POST');
    expect(new Headers(sent[0]?.init?.headers).get('authorization')).toBe('Bearer key-1');
    expect(JSON.parse(String(sent[0]?.init?.body))).toEqual({
      name: 'uw routine laptop',
      duration: '720h',
    });
  });

  it('throws on a refusal or an unreadable reply', async () => {
    const refused = configAnswering(new Response('no', { status: 403 }), []);
    await expect(createAccessServiceToken(refused, 'n', '1h')).rejects.toBeInstanceOf(
      AccessTokenError,
    );
    const odd = configAnswering(Response.json({ success: true, result: {} }), []);
    await expect(createAccessServiceToken(odd, 'n', '1h')).rejects.toBeInstanceOf(AccessTokenError);
  });
});

describe('removing and timing a Cloudflare Access service token', () => {
  it('deletes a token and counts one already gone as deleted', async () => {
    const sent: Sent[] = [];
    expect(await deleteAccessServiceToken(configAnswering(new Response(null), sent), 'cf-1')).toBe(
      true,
    );
    expect(sent[0]?.url).toBe(
      'https://api.cloudflare.com/client/v4/accounts/account-1/access/service_tokens/cf-1',
    );
    expect(sent[0]?.init?.method).toBe('DELETE');
    const gone = configAnswering(new Response(null, { status: 404 }), []);
    expect(await deleteAccessServiceToken(gone, 'cf-1')).toBe(true);
    const failed = configAnswering(new Response(null, { status: 500 }), []);
    expect(await deleteAccessServiceToken(failed, 'cf-1')).toBe(false);
  });

  it('lasts until the permission ends, in whole hours, never under one', () => {
    const at = new Date('2026-11-18T10:00:00.000Z');
    expect(durationUntil(at, new Date('2026-11-19T10:30:00.000Z'))).toBe('25h');
    expect(durationUntil(at, at)).toBe('1h');
  });
});
