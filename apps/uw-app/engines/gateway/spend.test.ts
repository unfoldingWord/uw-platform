import { describe, expect, it } from 'vitest';
import { fakeFetch } from '../../testing/engine-fetch.ts';
import reply from '../fixtures/gateway-spend.json' with { type: 'json' };
import { gatewaySpend, SpendUnreadableError } from './spend.ts';

const now = new Date('2026-10-03T12:00:00.000Z');
const since = new Date('2026-10-01T00:00:00.000Z');
const configured = {
  AI_GATEWAY_ACCOUNT_ID: 'account-1',
  AI_GATEWAY_ID: 'harness-gateway',
  AI_GATEWAY_ANALYTICS_TOKEN: 'analytics-token',
};

const noGroups = { aiGatewayRequestsAdaptiveGroups: [] };

type SentQuery = { readonly query: string; readonly variables: Readonly<Record<string, string>> };

async function summedCost(): Promise<void> {
  const analytics = fakeFetch();
  analytics.respondNext(200, reply);
  const spend = gatewaySpend({ ...configured, fetch: analytics.fetch }, () => now);
  expect(await spend(since)).toEqual({ spentMinor: 41_235, currency: 'USD', since, asOf: now });
  const [sent] = analytics.requests;
  expect(sent?.url).toBe('https://api.cloudflare.com/client/v4/graphql');
  expect(sent?.method).toBe('POST');
  expect(sent?.headers['authorization']).toBe('Bearer analytics-token');
  const body = sent?.body as SentQuery;
  expect(body.query).toContain('aiGatewayRequestsAdaptiveGroups');
  expect(body.query).toContain('sum { cost }');
  expect(body.variables).toEqual({
    account: 'account-1',
    gateway: 'harness-gateway',
    since: since.toISOString(),
    until: now.toISOString(),
  });
  const empty = fakeFetch();
  empty.respondNext(200, {
    data: { viewer: { accounts: [{ aiGatewayRequestsAdaptiveGroups: [] }] } },
    errors: null,
  });
  const none = await gatewaySpend({ ...configured, fetch: empty.fetch }, () => now)(since);
  expect(none.spentMinor).toBe(0);
}

async function unconfiguredOrUnreadable(): Promise<void> {
  for (const name of Object.keys(configured)) {
    const analytics = fakeFetch();
    const spend = gatewaySpend(
      { ...configured, [name]: undefined, fetch: analytics.fetch },
      () => now,
    );
    await expect(spend(since)).rejects.toMatchObject({
      name: 'PortNotWiredError',
      method: 'spend',
    });
    expect(analytics.requests).toEqual([]);
  }
  const failing: readonly (readonly [number, unknown])[] = [
    [503, { secret: 'upstream body with analytics-token' }],
    [200, { data: null, errors: [{ message: 'unknown field cost with analytics-token' }] }],
    [200, { data: { viewer: { accounts: [{ aiGatewayRequestsAdaptiveGroups: 'x' }] } } }],
    [200, { data: { viewer: { accounts: [] } }, errors: null }],
    [200, { data: { viewer: { accounts: [noGroups, noGroups] } }, errors: null }],
  ];
  for (const [status, body] of failing) {
    const analytics = fakeFetch();
    analytics.respondNext(status, body);
    const read = gatewaySpend({ ...configured, fetch: analytics.fetch }, () => now)(since);
    await expect(read).rejects.toBeInstanceOf(SpendUnreadableError);
    await expect(read).rejects.toMatchObject({ status });
    const message = await read.catch((error: unknown) => String(error));
    expect(message).not.toContain('analytics-token');
  }
}

describe('the AI Gateway spend reader', () => {
  it("HE-5 the spend is AI Gateway's summed cost for the month in minor units", summedCost);

  it(
    'an unconfigured reader is not_wired, and an error reply or a reply without exactly one account is unreadable without its body',
    unconfiguredOrUnreadable,
  );
});
