import { z } from 'zod';
import type { Bindings } from '../env.ts';

const API_ROOT = 'https://api.cloudflare.com/client/v4/accounts';
const HOURS_FLOOR = 1;
const HOUR_MS = 3_600_000;

export type AccessTokensConfig = {
  readonly accountId: string;
  readonly apiToken: string;
  readonly fetch: typeof fetch;
};

export type MadeAccessToken = {
  readonly id: string;
  readonly clientId: string;
  readonly clientSecret: string;
};

const madeSchema = z.object({
  success: z.literal(true),
  result: z.object({
    id: z.string().min(1).max(100),
    client_id: z.string().min(1).max(200),
    client_secret: z.string().min(1),
  }),
});

export class AccessTokenError extends Error {
  readonly status: number;

  constructor(action: string, status: number) {
    super(
      `the Cloudflare Access service token could not be ${action} (status ${status.toString()})`,
    );
    this.name = 'AccessTokenError';
    this.status = status;
  }
}

export function accessTokensConfigOf(
  env: Bindings,
  fetcher: typeof fetch,
): AccessTokensConfig | null {
  const accountId = env.ACCESS_ACCOUNT_ID;
  const apiToken = env.ACCESS_SERVICE_TOKENS_API_TOKEN;
  if (!accountId || !apiToken) return null;
  return { accountId, apiToken, fetch: fetcher };
}

function headersOf(config: AccessTokensConfig): Record<string, string> {
  return { authorization: `Bearer ${config.apiToken}`, 'content-type': 'application/json' };
}

export function durationUntil(at: Date, endsAt: Date): string {
  const hours = Math.max(HOURS_FLOOR, Math.ceil((endsAt.getTime() - at.getTime()) / HOUR_MS));
  return `${hours.toString()}h`;
}

export async function createAccessServiceToken(
  config: AccessTokensConfig,
  name: string,
  duration: string,
): Promise<MadeAccessToken> {
  const url = `${API_ROOT}/${encodeURIComponent(config.accountId)}/access/service_tokens`;
  const response = await config.fetch(url, {
    method: 'POST',
    headers: headersOf(config),
    body: JSON.stringify({ name, duration }),
  });
  if (!response.ok) throw new AccessTokenError('made', response.status);
  const parsed = madeSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw new AccessTokenError('made', response.status);
  const { id, client_id: clientId, client_secret: clientSecret } = parsed.data.result;
  return { id, clientId, clientSecret };
}

export async function deleteAccessServiceToken(
  config: AccessTokensConfig,
  id: string,
): Promise<boolean> {
  const account = encodeURIComponent(config.accountId);
  const url = `${API_ROOT}/${account}/access/service_tokens/${encodeURIComponent(id)}`;
  const response = await config.fetch(url, { method: 'DELETE', headers: headersOf(config) });
  return response.ok || response.status === 404;
}
