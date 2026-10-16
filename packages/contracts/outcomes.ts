import { z } from 'zod';

export const errorReasonSchema = z.enum([
  'pr_not_open',
  'pr_is_draft',
  'head_mismatch',
  'checks_not_green',
  'no_reviewer_approval',
  'risk_tier_undeclared',
  'reviewer_count_below_tier',
  'reviewer_providers_not_distinct',
  'approver_lacks_domain_grant',
  'not_permitted',
  'not_wired',
  'wip_limit_reached',
  'lease_held',
  'lease_expired',
  'pickup_not_allowed',
  'validator_failed',
  'unknown_validator',
  'delegation_required',
  'gate_refused_to_agent',
  'reason_required',
  'spend_held',
  'hosted_builder_off',
  'engine_not_available',
  'diff_exceeds_review_budget',
  'unknown_verb',
  'forbidden_verb',
  'malformed_command',
  'unauthenticated',
  'access_not_configured',
  'database_not_configured',
  'internal_error',
  'pending_approval',
  'person_not_found',
  'grant_not_found',
  'grant_exists',
  'last_org_admin',
  'expiry_in_past',
  'unknown_page_type',
  'invalid_frontmatter',
  'page_not_found',
  'page_exists',
  'slug_taken',
  'stale_version',
  'parent_not_found',
  'parent_cycle',
  'harness_not_found',
  'harness_exists',
  'stage_not_found',
  'item_not_found',
  'delegation_not_found',
  'delegation_lapsed',
  'not_holder',
  'transition_not_allowed',
  'unknown_feed_target',
  'connector_not_registered',
  'template_bypasses_gate',
  'stage_edit_refused',
  'item_not_at_gate',
  'reason_not_one_line',
  'decision_in_flight',
  'facts_stale',
  'request_in_flight',
  'issue_not_found',
  'stage_not_empty',
  'run_not_found',
  'activation_required',
  'dry_run_failed',
  'template_has_no_package',
  'no_harness_for_repo',
  'repository_not_dispatchable',
  'dispatch_list_unavailable',
  'base_behind',
  'auto_close_keyword',
  'skip_ci_marker',
  'required_check_never_ran',
  'harness_frozen',
  'finding_weight_missing',
  'protected_path_needs_person',
  'tier_above_delegation',
  'tier_not_delegable',
]);

export const refusalSchema = z.object({
  status: z.literal('error'),
  reason: errorReasonSchema,
});

export const acceptedOutcomeSchema = z.object({
  status: z.literal('accepted'),
  requestId: z.uuid(),
});

export const errorOutcomeSchema = z.object({
  status: z.literal('error'),
  requestId: z.uuid(),
  reason: errorReasonSchema,
});

export const outcomeSchema = z.discriminatedUnion('status', [
  acceptedOutcomeSchema,
  errorOutcomeSchema,
]);

export type ErrorReason = z.infer<typeof errorReasonSchema>;
export type Refusal = z.infer<typeof refusalSchema>;
export type AcceptedOutcome = z.infer<typeof acceptedOutcomeSchema>;
export type ErrorOutcome = z.infer<typeof errorOutcomeSchema>;
export type Outcome = z.infer<typeof outcomeSchema>;
