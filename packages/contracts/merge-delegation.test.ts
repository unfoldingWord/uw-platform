import { describe, expect, it } from 'vitest';
import { delegableTierSchema, wakeReasonSchema } from './closed-sets.ts';
import { commandSchema } from './commands.ts';
import { eventEvidenceSchemas } from './event-evidence.ts';
import { harnessSchema } from './harness.ts';
import { errorReasonSchema } from './outcomes.ts';
import { shipRefusalSchema, shipRuleInputSchema } from './ship-rule.ts';

const requestId = '3f1d7c1e-8c53-4a53-9d6e-0a9b6a0f4d11';
const delegationId = '00000000-0000-4000-8000-0000000000d1';
const personId = '00000000-0000-4000-8000-000000000001';

describe('MD-2 the merge grant names its tier', () => {
  it('MD-2 a merge grant names a tier, and high still parses so the kernel can refuse it', () => {
    const grant = {
      command: 'schedule_regular_tweak',
      requestId,
      persona: 'agent:builder',
      capability: 'merge',
      expiresAt: null,
      supersedes: null,
    };
    expect(commandSchema.parse(grant)).toMatchObject({ maxTier: null });
    expect(commandSchema.parse({ ...grant, maxTier: 'standard' })).toMatchObject({
      maxTier: 'standard',
    });
    expect(commandSchema.safeParse({ ...grant, maxTier: 'high' }).success).toBe(true);
    expect(commandSchema.safeParse({ ...grant, maxTier: 'urgent' }).success).toBe(false);
    expect(delegableTierSchema.options).toEqual(['low', 'standard']);
    expect(errorReasonSchema.options).toContain('tier_not_delegable');
  });

  it('MD-2 the grant event names the tier, and an older grant reads as none', () => {
    const granted = {
      delegationId,
      personId,
      persona: 'agent:builder',
      capability: 'merge',
      expiresAt: '2026-10-20T00:00:00.000Z',
      supersedes: null,
    };
    expect(eventEvidenceSchemas.delegation_granted.parse(granted)).toMatchObject({ maxTier: null });
    const high = { ...granted, maxTier: 'high' };
    expect(eventEvidenceSchemas.delegation_granted.safeParse(high).success).toBe(false);
  });
});

const neutralInput = {
  pullRequest: null,
  expectedHead: null,
  carries: [],
  checks: [],
  requiredChecks: [],
  approvals: [],
  closes: [],
  wraps: null,
  riskTier: null,
  riskDomains: [],
  area: '80-89',
  approver: {
    identity: `human:${personId}`,
    kind: 'person',
    personId,
    email: 'ian.lindsley@unfoldingword.org',
    grants: [],
    interactive: true,
  },
  at: '2026-10-15T09:00:00.000Z',
  frozen: false,
  override: false,
};

describe('MD-4 the ship rule takes the delegation as an input', () => {
  it('MD-4 the ship rule gains two refusals and the delegation as an input', () => {
    expect(shipRefusalSchema.options.slice(-2)).toEqual([
      'protected_path_needs_person',
      'tier_above_delegation',
    ]);
    for (const reason of shipRefusalSchema.options) {
      expect(errorReasonSchema.options).toContain(reason);
    }
    const input = shipRuleInputSchema.parse(neutralInput);
    expect(input.delegation).toBeNull();
    const lent = { delegationId, maxTier: 'standard', protectedTouched: [] };
    expect(shipRuleInputSchema.parse({ ...input, delegation: lent }).delegation).toEqual(lent);
    const high = { ...input, delegation: { ...lent, maxTier: 'high' } };
    expect(shipRuleInputSchema.safeParse(high).success).toBe(false);
  });
});

describe('MD-4 a harness lists its protected paths', () => {
  it('MD-4 a harness lists protected paths, relative and without dot-dot, and an older row lists none', () => {
    const older = {
      id: delegationId,
      key: 'tc-admin-app',
      template: 'check-only',
      jdArea: '80-89',
      repository: 'unfoldingWord/tc-admin-app',
      hostedBuilderEnabled: false,
      paused: false,
    };
    expect(harnessSchema.parse(older)).toMatchObject({ protectedPaths: [] });
    const listed = { ...older, protectedPaths: ['src/billing/', 'deploy.sh'] };
    expect(harnessSchema.safeParse(listed).success).toBe(true);
    for (const bad of ['/etc/', '../outside', 'src/../x', ' spaced', '']) {
      expect(harnessSchema.safeParse({ ...older, protectedPaths: [bad] }).success).toBe(false);
    }
    const twice = { ...older, protectedPaths: ['a/', 'a/'] };
    expect(harnessSchema.safeParse(twice).success).toBe(false);
  });
});

describe('MD-6 a delegated merge wakes its grantor', () => {
  it('MD-6 the grantor is woken by delegated_merge, which names the grantor and the expiry', () => {
    expect(wakeReasonSchema.options).toContain('delegated_merge');
    const merged = {
      decisionId: delegationId,
      delegationId,
      personId,
      email: 'ian.lindsley@unfoldingword.org',
      persona: 'agent:builder',
      expiresAt: '2026-10-20T00:00:00.000Z',
      maxTier: 'standard',
    };
    expect(eventEvidenceSchemas.delegated_merge.parse(merged)).toEqual(merged);
    const high = { ...merged, maxTier: 'high' };
    expect(eventEvidenceSchemas.delegated_merge.safeParse(high).success).toBe(false);
  });
});
