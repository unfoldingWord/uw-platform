import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { ErrorReason, Outcome } from '@uw/contracts';
import type { AppEnv } from '../deps.ts';

const DEFAULT_REFUSAL_STATUS: ContentfulStatusCode = 422;

const statusByReason = new Map<ErrorReason, ContentfulStatusCode>([
  ['unauthenticated', 401],
  ['not_permitted', 403],
  ['pending_approval', 403],
  ['activation_required', 403],
  ['person_not_found', 404],
  ['grant_not_found', 404],
  ['page_not_found', 404],
  ['file_not_found', 404],
  ['harness_not_found', 404],
  ['item_not_found', 404],
  ['stage_not_found', 404],
  ['issue_not_found', 404],
  ['delegation_not_found', 404],
  ['run_not_found', 404],
  ['not_wired', 404],
  ['draft_not_found', 404],
  ['cascade_node_not_found', 404],
  ['map_not_found', 404],
  ['export_not_found', 404],
  ['gate_refused_to_agent', 403],
  ['request_in_flight', 409],
  ['decision_in_flight', 409],
  ['wip_limit_reached', 409],
  ['lease_held', 409],
  ['not_holder', 409],
  ['stage_not_empty', 409],
  ['harness_exists', 409],
  ['grant_exists', 409],
  ['last_org_admin', 409],
  ['page_exists', 409],
  ['slug_taken', 409],
  ['stale_version', 409],
  ['embed_cycle', 409],
  ['draft_locked', 409],
  ['draft_stale', 409],
  ['draft_revision_mismatch', 409],
  ['draft_has_problems', 409],
  ['stage_rules_have_problems', 409],
  ['export_not_ready', 409],
  ['binder_empty', 422],
  ['binder_too_large', 422],
  ['export_limit_reached', 429],
  ['trial_required', 409],
  ['trial_unreadable', 409],
  ['measure_paused', 409],
  ['run_too_soon', 429],
  ['story_above_channel', 403],
  ['consent_required', 409],
  ['consent_not_started', 409],
  ['consent_expired', 409],
  ['consent_withdrawn', 409],
  ['photo_release_required', 409],
  ['story_retired', 409],
  ['expression_not_found', 404],
  ['expression_exists', 409],
  ['expression_decided', 409],
  ['malformed_command', 400],
  ['file_too_large', 413],
  ['file_type_not_allowed', 415],
  ['internal_error', 500],
  ['pdf_render_failed', 502],
  ['chart_png_failed', 502],
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
