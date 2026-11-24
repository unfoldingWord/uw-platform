export type GitHubFailure =
  | 'unreachable'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'not_mergeable'
  | 'unprocessable'
  | 'rate_limited'
  | 'server_error'
  | 'malformed_response'
  | 'key_not_pkcs8';

export type GitHubResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: GitHubFailure; readonly status: number | null };

const byStatus = new Map<number, GitHubFailure>([
  [401, 'unauthorized'],
  [403, 'forbidden'],
  [404, 'not_found'],
  [405, 'not_mergeable'],
  [409, 'conflict'],
  [422, 'unprocessable'],
  [429, 'rate_limited'],
]);

function isRateLimit(headers: Headers): boolean {
  return headers.get('x-ratelimit-remaining') === '0' || headers.has('retry-after');
}

export function failureOf(status: number, headers: Headers): GitHubFailure {
  if (status === 403 && isRateLimit(headers)) return 'rate_limited';
  if (status >= 500) return 'server_error';
  return byStatus.get(status) ?? 'unprocessable';
}

export function failed(failure: GitHubFailure, status: number | null): GitHubResult<never> {
  return { ok: false, failure, status };
}
