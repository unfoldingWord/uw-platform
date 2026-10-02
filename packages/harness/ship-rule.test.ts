import {
  ciJobSchema,
  principalSchema,
  shipRuleInputSchema,
  type JdArea,
  type Principal,
  type Role,
  type ShipRefusal,
  type ShipRuleInput,
} from '@uw/contracts';
import { describe, expect, it } from 'vitest';
import { shipRule } from './ship-rule.ts';

type Held = { readonly role: Role; readonly area: JdArea | null };

function approverOf(...held: readonly Held[]): Principal {
  return principalSchema.parse({
    identity: 'human:00000000-0000-4000-8000-000000000a01',
    kind: 'person',
    personId: '00000000-0000-4000-8000-000000000a01',
    email: 'approver@unfoldingword.org',
    interactive: true,
    grants: held.map((entry, index) => ({
      grantId: `00000000-0000-4000-8000-0000000000${String(index + 10)}`,
      role: entry.role,
      scopeKind: entry.area === null ? 'org' : 'jd_area',
      scopeArea: entry.area,
      expiresAt: null,
    })),
  });
}

const areaAdmin = approverOf({ role: 'admin', area: '80-89' });
const orgAdmin = approverOf({ role: 'admin', area: null });

function green(): ShipRuleInput {
  return shipRuleInputSchema.parse({
    pullRequest: { open: true, draft: false, head: 'abc123' },
    expectedHead: 'abc123',
    checks: ciJobSchema.options.map((name) => ({
      name,
      headSha: 'abc123',
      conclusion: 'success',
    })),
    approvals: [{ reviewer: 'reviewer-openrouter', commit: 'abc123', provider: 'anthropic' }],
    riskTier: 'standard',
    riskDomains: [],
    area: '80-89',
    approver: areaAdmin,
    at: '2026-10-01T09:00:00.000Z',
    override: false,
  });
}

function refusedWith(input: ShipRuleInput): readonly ShipRefusal[] {
  const outcome = shipRule(input);
  return outcome.verdict === 'refuse' ? outcome.reasons : [];
}

function approval(reviewer: string, provider: string | null, commit = 'abc123') {
  return { reviewer, commit, provider };
}

function withChecks(replace: (name: string) => ShipRuleInput['checks']): ShipRuleInput['checks'] {
  return ciJobSchema.options.flatMap((name) => replace(name));
}

describe('KN-11 the ship rule advances on green facts', () => {
  it('advances', () => {
    expect(shipRule(green())).toEqual({ verdict: 'advance' });
  });
});

describe('KN-11 each fact refuses with its reason', () => {
  it('refuses a missing, closed or draft pull request', () => {
    expect(refusedWith({ ...green(), pullRequest: null })).toEqual([
      'pr_not_open',
      'head_mismatch',
      'checks_not_green',
      'no_reviewer_approval',
    ]);
    const closed = { open: false, draft: false, head: 'abc123' };
    expect(refusedWith({ ...green(), pullRequest: closed })).toEqual(['pr_not_open']);
    const draft = { open: true, draft: true, head: 'abc123' };
    expect(refusedWith({ ...green(), pullRequest: draft })).toEqual(['pr_is_draft']);
  });

  it('refuses a head that is not the expected commit, or an unknown expected commit', () => {
    const moved = { open: true, draft: false, head: 'def456' };
    expect(refusedWith({ ...green(), pullRequest: moved })).toEqual([
      'head_mismatch',
      'checks_not_green',
      'no_reviewer_approval',
    ]);
    expect(refusedWith({ ...green(), expectedHead: null })).toEqual(['head_mismatch']);
  });
});

describe('KN-11 each fact refuses with its reason (checks)', () => {
  it('refuses a missing, red, pending or off-head check', () => {
    const missing = withChecks((name) =>
      name === 'lint' ? [] : [{ name, headSha: 'abc123', conclusion: 'success' }],
    );
    expect(refusedWith({ ...green(), checks: missing })).toEqual(['checks_not_green']);
    const red = withChecks((name) => [
      { name, headSha: 'abc123', conclusion: name === 'test' ? 'failure' : 'success' },
    ]);
    expect(refusedWith({ ...green(), checks: red })).toEqual(['checks_not_green']);
    const pending = withChecks((name) => [
      { name, headSha: 'abc123', conclusion: name === 'build' ? null : 'success' },
    ]);
    expect(refusedWith({ ...green(), checks: pending })).toEqual(['checks_not_green']);
    const stale = withChecks((name) => [
      { name, headSha: name === 'build' ? 'old999' : 'abc123', conclusion: 'success' },
    ]);
    expect(refusedWith({ ...green(), checks: stale })).toEqual(['checks_not_green']);
  });

  it('ignores a seventh unrelated check', () => {
    const extra = [
      ...green().checks,
      { name: 'codecov', headSha: 'abc123', conclusion: 'failure' as const },
    ];
    expect(shipRule({ ...green(), checks: extra })).toEqual({ verdict: 'advance' });
  });

  it('refuses a failure re-run beside a success of the same job', () => {
    const rerun = [
      ...green().checks,
      { name: 'lint', headSha: 'abc123', conclusion: 'failure' as const },
    ];
    expect(refusedWith({ ...green(), checks: rerun })).toEqual(['checks_not_green']);
  });
});

describe('KN-11 each fact refuses with its reason (reviews and risk)', () => {
  it('refuses no approval, and an approval on another commit does not count', () => {
    expect(refusedWith({ ...green(), approvals: [] })).toEqual(['no_reviewer_approval']);
    const old = [approval('reviewer-openrouter', 'anthropic', 'old999')];
    expect(refusedWith({ ...green(), approvals: old })).toEqual(['no_reviewer_approval']);
  });

  it('refuses an undeclared risk tier', () => {
    expect(refusedWith({ ...green(), riskTier: null })).toEqual(['risk_tier_undeclared']);
  });

  it('does not refuse low or standard for a missing provider', () => {
    const noProvider = [approval('reviewer-openrouter', null)];
    expect(shipRule({ ...green(), approvals: noProvider })).toEqual({ verdict: 'advance' });
    expect(shipRule({ ...green(), riskTier: 'low' })).toEqual({ verdict: 'advance' });
  });
});

describe('KN-12 low and standard need one reviewer; high needs two on distinct providers', () => {
  const high = { ...green(), riskTier: 'high' as const };

  it('refuses high with one reviewer', () => {
    expect(refusedWith(high)).toEqual(['reviewer_count_below_tier']);
  });

  it('counts a reviewer once however many approvals it left', () => {
    const twice = [approval('r1', 'anthropic'), approval('r1', 'openai')];
    expect(refusedWith({ ...high, approvals: twice })).toEqual(['reviewer_count_below_tier']);
  });

  it('does not count an approval on another commit toward the two', () => {
    const mixed = [approval('r1', 'anthropic'), approval('r2', 'openai', 'old999')];
    expect(refusedWith({ ...high, approvals: mixed })).toEqual(['reviewer_count_below_tier']);
  });

  it('refuses two reviewers on one provider, or with an unresolved provider', () => {
    const same = [approval('r1', 'anthropic'), approval('r2', 'anthropic')];
    expect(refusedWith({ ...high, approvals: same })).toEqual(['reviewer_providers_not_distinct']);
    const unresolved = [approval('r1', 'anthropic'), approval('r2', null)];
    expect(refusedWith({ ...high, approvals: unresolved })).toEqual([
      'reviewer_providers_not_distinct',
    ]);
  });

  it('counts providers per reviewer: a reviewer with two providers is unresolved', () => {
    const split = [approval('r1', 'anthropic'), approval('r1', 'openai'), approval('r2', null)];
    expect(refusedWith({ ...high, approvals: split })).toEqual(['reviewer_providers_not_distinct']);
    const twoPlusOne = [approval('r1', 'anthropic'), approval('r1', 'openai'), approval('r2', 'x')];
    expect(refusedWith({ ...high, approvals: twoPlusOne })).toEqual([
      'reviewer_providers_not_distinct',
    ]);
  });

  it('normalises provider and reviewer case and whitespace', () => {
    const cased = [approval('r1', 'anthropic'), approval('r2', ' Anthropic ')];
    expect(refusedWith({ ...high, approvals: cased })).toEqual(['reviewer_providers_not_distinct']);
    const same = [approval('r1', 'anthropic'), approval('R1 ', 'openai')];
    expect(refusedWith({ ...high, approvals: same })).toEqual(['reviewer_count_below_tier']);
  });

  it('advances on two reviewers with distinct providers', () => {
    const distinct = [approval('r1', 'anthropic'), approval('r2', 'openai')];
    expect(shipRule({ ...high, approvals: distinct })).toEqual({ verdict: 'advance' });
    const domains = { ...high, approvals: distinct, riskDomains: ['acl' as const] };
    expect(shipRule({ ...domains, approver: orgAdmin })).toEqual({ verdict: 'advance' });
  });
});

describe('KN-12 the approver holds admin on the area plus each domain grant', () => {
  const domain = (riskDomains: ShipRuleInput['riskDomains']) => ({ ...green(), riskDomains });

  it('refuses acl for an area admin and advances for an org admin', () => {
    expect(refusedWith(domain(['acl']))).toEqual(['approver_lacks_domain_grant']);
    expect(shipRule({ ...domain(['acl']), approver: orgAdmin })).toEqual({ verdict: 'advance' });
  });

  it('advances ledger for admin on 80-89 and on 20-29, and refuses with only one of them', () => {
    const both = approverOf({ role: 'admin', area: '80-89' }, { role: 'admin', area: '20-29' });
    expect(shipRule({ ...domain(['ledger']), approver: both })).toEqual({ verdict: 'advance' });
    expect(refusedWith(domain(['ledger']))).toEqual(['approver_lacks_domain_grant']);
  });

  it('refuses admin on 20-29 only when the area is 80-89', () => {
    const other = approverOf({ role: 'admin', area: '20-29' });
    expect(refusedWith({ ...green(), approver: other })).toEqual(['approver_lacks_domain_grant']);
  });

  it('refuses an editor on the area', () => {
    const editor = approverOf({ role: 'editor', area: '80-89' });
    expect(refusedWith({ ...green(), approver: editor })).toEqual(['approver_lacks_domain_grant']);
  });

  it('refuses a grant that has expired at the instant', () => {
    const expired = principalSchema.parse({
      ...areaAdmin,
      grants: areaAdmin.grants.map((grant) => ({
        ...grant,
        expiresAt: '2026-10-01T08:00:00.000Z',
      })),
    });
    expect(refusedWith({ ...green(), approver: expired })).toEqual(['approver_lacks_domain_grant']);
  });
});

describe('KN-11 P11 every failing reason is reported, in section 8.5 order', () => {
  it('returns every failing reason in schema order', () => {
    const everything: ShipRuleInput = {
      ...green(),
      pullRequest: { open: true, draft: true, head: 'def456' },
      checks: green().checks.map((check) => ({ ...check, conclusion: 'failure' as const })),
      approvals: [],
      riskTier: null,
      riskDomains: ['acl'],
      approver: approverOf({ role: 'editor', area: '80-89' }),
    };
    expect(refusedWith(everything)).toEqual([
      'pr_is_draft',
      'head_mismatch',
      'checks_not_green',
      'no_reviewer_approval',
      'risk_tier_undeclared',
      'approver_lacks_domain_grant',
    ]);
  });
});

describe('KN-12 P12 override bypasses no_reviewer_approval and nothing else', () => {
  const override = (input: ShipRuleInput): ShipRuleInput => ({ ...input, override: true });

  it('advances an unreviewed pull request when overridden', () => {
    expect(shipRule(override({ ...green(), approvals: [] }))).toEqual({ verdict: 'advance' });
  });

  it('still refuses head mismatch, red checks, undeclared tier and the grant check', () => {
    const moved = { open: true, draft: false, head: 'def456' };
    const red = green().checks.map((check) => ({ ...check, conclusion: 'failure' as const }));
    const bare = { ...green(), approvals: [] };
    expect(refusedWith(override({ ...bare, pullRequest: moved }))).toEqual([
      'head_mismatch',
      'checks_not_green',
    ]);
    expect(refusedWith(override({ ...bare, checks: red }))).toEqual(['checks_not_green']);
    expect(refusedWith(override({ ...bare, riskTier: null }))).toEqual(['risk_tier_undeclared']);
    expect(refusedWith(override({ ...bare, riskDomains: ['acl'] }))).toEqual([
      'approver_lacks_domain_grant',
    ]);
  });

  it('still refuses the high reviewer rules', () => {
    const high = override({ ...green(), riskTier: 'high', approvals: [] });
    expect(refusedWith(high)).toEqual(['reviewer_count_below_tier']);
    const same = [approval('r1', 'anthropic'), approval('r2', 'anthropic')];
    expect(refusedWith({ ...high, approvals: same })).toEqual(['reviewer_providers_not_distinct']);
  });
});
