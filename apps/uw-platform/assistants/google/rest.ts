import { accessToken, forgetToken, type TokenDeps } from './token.ts';

type GoogleFailure = 'refused' | 'unavailable' | 'not_found' | 'conflict' | 'gone';
export type GoogleAnswer =
  | { readonly ok: true; readonly body: unknown }
  | { readonly ok: false; readonly failure: GoogleFailure };
export type GoogleCall = {
  readonly subject: string;
  readonly scopes: readonly string[];
  readonly method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  readonly url: string;
  readonly body?: unknown;
};

const TIMEOUT_MS = 5_000;
const UNAUTHORIZED = 401;
const failureByStatus: ReadonlyMap<number, GoogleFailure> = new Map([
  [400, 'refused'],
  [401, 'refused'],
  [403, 'refused'],
  [404, 'not_found'],
  [409, 'conflict'],
  [410, 'gone'],
]);

function failed(failure: GoogleFailure): GoogleAnswer {
  return { ok: false, failure };
}

function requestOf(call: GoogleCall, token: string): RequestInit {
  const headers: Record<string, string> = { authorization: `Bearer ${token}` };
  const init: RequestInit = {
    method: call.method,
    headers,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  };
  if (call.body !== undefined) {
    headers['content-type'] = 'application/json';
    init.body = JSON.stringify(call.body);
  }
  return init;
}

async function sent(deps: TokenDeps, call: GoogleCall, token: string): Promise<Response> {
  const response = await deps.fetcher(call.url, requestOf(call, token));
  if (response.status !== UNAUTHORIZED) return response;
  forgetToken(deps, call.subject, call.scopes);
  const minted = await accessToken(deps, call.subject, call.scopes);
  return minted.ok ? deps.fetcher(call.url, requestOf(call, minted.token)) : response;
}

export async function googleCall(deps: TokenDeps, call: GoogleCall): Promise<GoogleAnswer> {
  const minted = await accessToken(deps, call.subject, call.scopes);
  if (!minted.ok) return failed(minted.failure === 'unavailable' ? 'unavailable' : 'refused');
  try {
    const response = await sent(deps, call, minted.token);
    const known = failureByStatus.get(response.status);
    if (known !== undefined) return failed(known);
    if (!response.ok) return failed('unavailable');
    if (response.status === 204) return { ok: true, body: null };
    return { ok: true, body: await response.json() };
  } catch {
    return failed('unavailable');
  }
}
