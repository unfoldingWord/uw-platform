import type { Timers } from '../../timers.ts';

export type ZulipFailure = 'rate_limited' | 'refused' | 'unknown';
export type ZulipOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: ZulipFailure; readonly retryAfterMs?: number };

export type ZulipIdentity = { readonly email: string; readonly apiKey: string };

export type ZulipHost = {
  readonly site: string;
  readonly fetcher: typeof fetch;
  readonly timers: Timers;
};

export type ZulipCall = {
  readonly method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  readonly path: string;
  readonly form?: Readonly<Record<string, string>>;
  readonly signIn: ZulipIdentity;
  readonly timeoutMs: number;
};

export type ZulipBody = Readonly<Record<string, unknown>>;

const RETRY_AFTER_MOST_SECONDS = 3_600;

function failed(failure: ZulipFailure, retryAfterMs?: number): ZulipOutcome<never> {
  return retryAfterMs === undefined ? { ok: false, failure } : { ok: false, failure, retryAfterMs };
}

function retryAfterOf(headers: Headers): number {
  const seconds = Number(headers.get('retry-after') ?? '');
  if (!Number.isFinite(seconds) || seconds < 0) return 1_000;
  return Math.ceil(Math.min(seconds, RETRY_AFTER_MOST_SECONDS) * 1_000);
}

function bodyOf(value: unknown): ZulipBody | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as ZulipBody)
    : null;
}

async function answerOf(response: Response): Promise<ZulipOutcome<ZulipBody>> {
  if (response.status === 429) return failed('rate_limited', retryAfterOf(response.headers));
  const body = bodyOf(await response.json().catch(() => null));
  if (response.status >= 500 || body === null) return failed('unknown');
  if (response.status !== 200 || body['result'] !== 'success') return failed('refused');
  return { ok: true, value: body };
}

function requestOf(host: ZulipHost, call: ZulipCall, signal: AbortSignal): Promise<Response> {
  const { email, apiKey } = call.signIn;
  const headers: Record<string, string> = { authorization: `Basic ${btoa(`${email}:${apiKey}`)}` };
  const init: RequestInit = { method: call.method, headers, signal };
  if (call.form !== undefined) {
    headers['content-type'] = 'application/x-www-form-urlencoded';
    init.body = new URLSearchParams({ ...call.form }).toString();
  }
  return host.fetcher(`${host.site}${call.path}`, init);
}

export async function zulipCall(
  host: ZulipHost,
  call: ZulipCall,
): Promise<ZulipOutcome<ZulipBody>> {
  const stop = new AbortController();
  try {
    const expiry = host.timers
      .after(call.timeoutMs, stop.signal)
      .then(() => failed('unknown') as ZulipOutcome<ZulipBody>);
    const answer = requestOf(host, call, stop.signal).then(answerOf);
    return await Promise.race([answer, expiry]);
  } catch {
    return failed('unknown');
  } finally {
    stop.abort();
  }
}
