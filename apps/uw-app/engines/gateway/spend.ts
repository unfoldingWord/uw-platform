import { z } from 'zod';
import { notWiredCall, type ModelEngine } from '@uw/harness';
import type { EngineConfig } from '../config.ts';

const ANALYTICS_URL = 'https://api.cloudflare.com/client/v4/graphql';
const CURRENCY = 'USD';
const MINOR_PER_UNIT = 100;

const SPEND_QUERY = `query Spend($account: string!, $gateway: string!, $since: Time!, $until: Time!) {
  viewer {
    accounts(filter: { accountTag: $account }) {
      aiGatewayRequestsAdaptiveGroups(
        limit: 1
        filter: { gateway: $gateway, datetime_geq: $since, datetime_lt: $until }
      ) {
        count
        sum { cost }
      }
    }
  }
}`;

const replySchema = z.object({
  data: z.object({
    viewer: z.object({
      accounts: z.tuple([
        z.object({
          aiGatewayRequestsAdaptiveGroups: z.array(
            z.object({
              count: z.number().int().nonnegative(),
              sum: z.object({ cost: z.number().nonnegative().nullable() }),
            }),
          ),
        }),
      ]),
    }),
  }),
  errors: z.null().optional(),
});

export class SpendUnreadableError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`the AI Gateway spend could not be read (status ${status.toString()})`);
    this.name = 'SpendUnreadableError';
    this.status = status;
  }
}

function costOf(reply: z.infer<typeof replySchema>): number | null {
  const [account] = reply.data.viewer.accounts;
  let total = 0;
  for (const group of account.aiGatewayRequestsAdaptiveGroups) {
    if (group.sum.cost === null && group.count > 0) return null;
    total += group.sum.cost ?? 0;
  }
  return total;
}

export function gatewaySpend(config: EngineConfig, now: () => Date): ModelEngine['spend'] {
  const account = config.AI_GATEWAY_ACCOUNT_ID;
  const gateway = config.AI_GATEWAY_ID;
  const token = config.AI_GATEWAY_ANALYTICS_TOKEN;
  if (!account || !gateway || !token) return () => notWiredCall('modelEngine', 'spend');
  return async (since) => {
    const asOf = now();
    const variables = { account, gateway, since: since.toISOString(), until: asOf.toISOString() };
    const response = await config.fetch(ANALYTICS_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ query: SPEND_QUERY, variables }),
    });
    if (!response.ok) throw new SpendUnreadableError(response.status);
    const parsed = replySchema.safeParse(await response.json().catch(() => null));
    const cost = parsed.success ? costOf(parsed.data) : null;
    if (cost === null) throw new SpendUnreadableError(response.status);
    const spentMinor = Math.round(cost * MINOR_PER_UNIT);
    return { spentMinor, currency: CURRENCY, since, asOf };
  };
}
