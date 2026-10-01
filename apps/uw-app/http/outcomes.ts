import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { ErrorReason, Outcome } from '@uw/contracts';
import type { AppEnv } from '../deps.ts';

const DEFAULT_REFUSAL_STATUS: ContentfulStatusCode = 422;

const statusByReason = new Map<ErrorReason, ContentfulStatusCode>([
  ['unauthenticated', 401],
  ['not_permitted', 403],
  ['pending_approval', 403],
  ['person_not_found', 404],
  ['grant_not_found', 404],
  ['page_not_found', 404],
  ['not_wired', 404],
  ['grant_exists', 409],
  ['last_org_admin', 409],
  ['page_exists', 409],
  ['slug_taken', 409],
  ['stale_version', 409],
  ['malformed_command', 400],
  ['internal_error', 500],
  ['access_not_configured', 503],
  ['database_not_configured', 503],
]);

export function refuse(c: Context<AppEnv>, reason: ErrorReason): Response {
  c.set('outcome', reason);
  return c.json({ status: 'error', reason }, statusByReason.get(reason) ?? DEFAULT_REFUSAL_STATUS);
}

export function reply(c: Context<AppEnv>, outcome: Outcome): Response {
  if (outcome.status === 'error') {
    c.set('outcome', outcome.reason);
    return c.json(outcome, statusByReason.get(outcome.reason) ?? DEFAULT_REFUSAL_STATUS);
  }
  c.set('outcome', 'accepted');
  return c.json(outcome, 200);
}
