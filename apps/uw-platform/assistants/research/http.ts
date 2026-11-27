export type Fetcher = typeof fetch;
export type HttpFailure = 'refused' | 'unavailable';
export type HttpAnswer =
  | { readonly ok: true; readonly body: unknown }
  | { readonly ok: false; readonly failure: HttpFailure };

const REFUSED_STATUSES: ReadonlySet<number> = new Set([400, 401, 402, 403, 404, 422]);

export function failureOf(status: number): HttpFailure {
  return REFUSED_STATUSES.has(status) ? 'refused' : 'unavailable';
}

export async function jsonCall(
  fetcher: Fetcher,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<HttpAnswer> {
  try {
    const response = await fetcher(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return { ok: false, failure: failureOf(response.status) };
    return { ok: true, body: await response.json() };
  } catch {
    return { ok: false, failure: 'unavailable' };
  }
}
