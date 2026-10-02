import { describe, expect, it } from 'vitest';
import { errorReasonSchema } from './outcomes.ts';
import {
  branchStateSchema,
  delegationLapseSchema,
  gateStatusSchema,
  runOutcomeSchema,
  stageBracketSchema,
} from './closed-sets.ts';
import { stageKeySchema } from './harness.ts';
import { ciJobSchema, shipRefusalSchema, shipRuleInputSchema } from './ship-rule.ts';

const stepThreeReasons = [
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
];

describe('KN-1 the harness closed sets', () => {
  it('holds the stage brackets, gate states, branch states, run outcomes and lapse reasons', () => {
    expect(stageBracketSchema.options).toEqual([
      'product_package',
      'build_package',
      'deploy_package',
      'iterate',
    ]);
    expect(gateStatusSchema.options).toEqual(['working', 'parked', 'checks_failed', 'done']);
    expect(branchStateSchema.options).toEqual(['none', 'active', 'abandoned']);
    expect(runOutcomeSchema.options).toEqual([
      'running',
      'hibernated',
      'stopped',
      'completed',
      'failed',
    ]);
    expect(delegationLapseSchema.options).toEqual(['expired', 'revoked', 'grant_lost']);
  });

  it('keys stages in lowercase snake case', () => {
    expect(stageKeySchema.safeParse('package').success).toBe(true);
    expect(stageKeySchema.safeParse('human_review').success).toBe(true);
    expect(stageKeySchema.safeParse('Package').success).toBe(false);
    expect(stageKeySchema.safeParse('1st').success).toBe(false);
  });
});

describe('KN-12 the ship rule refusal set is section 8.5, in its order', () => {
  it('lists the nine ship-rule reasons, each an error reason', () => {
    expect(shipRefusalSchema.options).toEqual([
      'pr_not_open',
      'pr_is_draft',
      'head_mismatch',
      'checks_not_green',
      'no_reviewer_approval',
      'risk_tier_undeclared',
      'reviewer_count_below_tier',
      'reviewer_providers_not_distinct',
      'approver_lacks_domain_grant',
    ]);
    for (const reason of shipRefusalSchema.options) {
      expect(errorReasonSchema.safeParse(reason).success).toBe(true);
    }
  });

  it('names the six CI jobs of FD-4', () => {
    expect(ciJobSchema.options).toEqual([
      'security-audit',
      'lint',
      'typecheck',
      'architecture',
      'test',
      'build',
    ]);
  });

  it('adds the step 3 refusal reasons', () => {
    for (const reason of stepThreeReasons) {
      expect(errorReasonSchema.safeParse(reason).success).toBe(true);
    }
  });
});

describe('KN-11 the ship rule input has no field for the narrative', () => {
  it('lists exactly the inputs the rule reads', () => {
    expect(Object.keys(shipRuleInputSchema.shape).sort()).toEqual(
      [
        'approvals',
        'approver',
        'area',
        'at',
        'checks',
        'expectedHead',
        'override',
        'pullRequest',
        'riskDomains',
        'riskTier',
      ].sort(),
    );
  });
});
