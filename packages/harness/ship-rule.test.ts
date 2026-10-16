import {
  ciJobSchema,
  defaultCiChecks,
  principalSchema,
  shipRuleInputSchema,
  type JdArea,
  type Principal,
  type Role,
  type ShipRefusal,
  type ShipRuleInput,
} from '@uw/contracts';
import { describe, expect, it } from 'vitest';
import { countedApprovals, shipRule } from './ship-rule.ts';

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
    pullRequest: { open: true, draft: false, head: 'abc123', behindBy: 0, skipCi: false },
    expectedHead: 'abc123',
    carries: [],
    checks: ciJobSchema.options.map((name) => ({
      name,
      app: 'github-actions',
      headSha: 'abc123',
      conclusion: 'success',
    })),
    requiredChecks: [...defaultCiChecks],
    approvals: [{ reviewer: 'reviewer-openrouter', commit: 'abc123', provider: 'anthropic' }],
    closes: [],
    wraps: null,
    riskTier: 'standard',
    riskDomains: [],
    area: '80-89',
    approver: areaAdmin,
    at: '2026-10-01T09:00:00.000Z',
    frozen: false,
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
    const closed = { open: false, draft: false, head: 'abc123', behindBy: 0, skipCi: false };
    expect(refusedWith({ ...green(), pullRequest: closed })).toEqual(['pr_not_open']);
    const draft = { open: true, draft: true, head: 'abc123', behindBy: 0, skipCi: false };
    expect(refusedWith({ ...green(), pullRequest: draft })).toEqual(['pr_is_draft']);
  });

  it('refuses a head that is not the expected commit, or an unknown expected commit', () => {
    const moved = { open: true, draft: false, head: 'def456', behindBy: 0, skipCi: false };
    expect(refusedWith({ ...green(), pullRequest: moved })).toEqual([
      'head_mismatch',
      'no_reviewer_approval',
      'required_check_never_ran',
    ]);
    expect(refusedWith({ ...green(), expectedHead: null })).toEqual(['head_mismatch']);
  });
});

describe('KN-11 each fact refuses with its reason (checks)', () => {
  it('refuses a missing, red, pending or off-head check', () => {
    const run = (name: string, headSha: string, conclusion: 'success' | 'failure' | null) => [
      { name, app: 'github-actions', headSha, conclusion },
    ];
    const missing = withChecks((name) => (name === 'lint' ? [] : run(name, 'abc123', 'success')));
    expect(refusedWith({ ...green(), checks: missing })).toEqual(['required_check_never_ran']);
    const red = withChecks((name) => run(name, 'abc123', name === 'test' ? 'failure' : 'success'));
    expect(refusedWith({ ...green(), checks: red })).toEqual(['checks_not_green']);
    const pending = withChecks((name) => run(name, 'abc123', name === 'build' ? null : 'success'));
    expect(refusedWith({ ...green(), checks: pending })).toEqual(['checks_not_green']);
    const stale = withChecks((name) =>
      run(name, name === 'build' ? 'old999' : 'abc123', 'success'),
    );
    expect(refusedWith({ ...green(), checks: stale })).toEqual(['required_check_never_ran']);
  });

  it('ignores a seventh unrelated check', () => {
    const extra = [
      ...green().checks,
      { name: 'codecov', app: 'github-actions', headSha: 'abc123', conclusion: 'failure' as const },
    ];
    expect(shipRule({ ...green(), checks: extra })).toEqual({ verdict: 'advance' });
  });

  it('refuses a failure re-run beside a success of the same job', () => {
    const rerun = [
      ...green().checks,
      { name: 'lint', app: 'github-actions', headSha: 'abc123', conclusion: 'failure' as const },
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
});

describe('KN-12 lookalike and fullwidth identifiers', () => {
  const high = { ...green(), riskTier: 'high' as const };

  it('treats lookalike reviewers and providers as unresolved', () => {
    const lookalikes = ['\u0430nthropic', 'anthropic\u200b', '\u0130penai', 'open\u0430i'];
    for (const provider of lookalikes) {
      const pair = [approval('r1', 'anthropic'), approval('r2', provider)];
      expect(refusedWith({ ...high, approvals: pair })).toEqual([
        'reviewer_providers_not_distinct',
      ]);
    }
    const reviewers = [approval('r1', 'anthropic'), approval('r\u0432', 'openai')];
    expect(refusedWith({ ...high, approvals: reviewers })).toEqual(['reviewer_count_below_tier']);
    const zeroWidth = [approval('r1', 'anthropic'), approval('r2\u200b', 'openai')];
    expect(refusedWith({ ...high, approvals: zeroWidth })).toEqual(['reviewer_count_below_tier']);
    expect(refusedWith({ ...green(), approvals: [approval('\u0440', 'anthropic')] })).toEqual([
      'no_reviewer_approval',
    ]);
  });

  it('folds fullwidth forms to the same reviewer and provider', () => {
    const wide = [approval('r1', 'anthropic'), approval('\uff52\uff11', '\uff41nthropic')];
    expect(refusedWith({ ...high, approvals: wide })).toEqual(['reviewer_count_below_tier']);
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
      pullRequest: { open: true, draft: true, head: 'def456', behindBy: 0, skipCi: false },
      checks: green().checks.map((check) => ({
        ...check,
        headSha: 'def456',
        conclusion: 'failure' as const,
      })),
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
    const moved = { open: true, draft: false, head: 'def456', behindBy: 0, skipCi: false };
    const red = green().checks.map((check) => ({ ...check, conclusion: 'failure' as const }));
    const bare = { ...green(), approvals: [] };
    expect(refusedWith(override({ ...bare, pullRequest: moved }))).toEqual([
      'head_mismatch',
      'required_check_never_ran',
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

function onPullRequest(over: Partial<NonNullable<ShipRuleInput['pullRequest']>>): ShipRuleInput {
  const pullRequest = { open: true, draft: false, head: 'abc123', behindBy: 0, skipCi: false };
  return { ...green(), pullRequest: { ...pullRequest, ...over } };
}

describe('SR-1 the ship rule refuses on the comparison and the closing references', () => {
  it('SR-1 refuses base_behind when the head is behind its base or the distance is unknown', () => {
    expect(refusedWith(onPullRequest({ behindBy: 3 }))).toEqual(['base_behind']);
    expect(refusedWith(onPullRequest({ behindBy: null }))).toEqual(['base_behind']);
  });

  it('SR-1 refuses auto_close_keyword for a closing reference to an issue the item does not wrap', () => {
    const wrapped = { repo: 'unfoldingWord/uw-platform', number: 12 };
    const shouted = { repo: 'UNFOLDINGWORD/UW-PLATFORM', number: 12 };
    expect(refusedWith({ ...green(), closes: [wrapped], wraps: wrapped })).toEqual([]);
    expect(refusedWith({ ...green(), closes: [shouted], wraps: wrapped })).toEqual([]);
    const other = { ...green(), closes: [{ ...wrapped, number: 13 }], wraps: wrapped };
    expect(refusedWith(other)).toEqual(['auto_close_keyword']);
    expect(refusedWith({ ...green(), closes: [wrapped], wraps: null })).toEqual([
      'auto_close_keyword',
    ]);
    expect(refusedWith({ ...green(), closes: null, wraps: wrapped })).toEqual([
      'auto_close_keyword',
    ]);
  });

  it('SR-1 refuses skip_ci_marker on a marked commit or unknown commits', () => {
    expect(refusedWith(onPullRequest({ skipCi: true }))).toEqual(['skip_ci_marker']);
    expect(refusedWith(onPullRequest({ skipCi: null }))).toEqual(['skip_ci_marker']);
  });

  it('SR-1 keeps the v0.1.0 reasons alone when there is no usable pull request', () => {
    const none = {
      ...green(),
      pullRequest: null,
      closes: [{ repo: 'unfoldingWord/uw-platform', number: 9 }],
    };
    expect(refusedWith(none)).toEqual([
      'pr_not_open',
      'head_mismatch',
      'checks_not_green',
      'no_reviewer_approval',
    ]);
  });
});

describe('SR-1 GD-2 the ship rule refuses on required checks and the freeze', () => {
  it('SR-1 refuses required_check_never_ran for a required check with no run on the head, and checks_not_green for one that failed', () => {
    const missing = { ...green(), checks: green().checks.filter((check) => check.name !== 'lint') };
    expect(refusedWith(missing)).toEqual(['required_check_never_ran']);
    const failed = {
      ...green(),
      checks: green().checks.map((check) =>
        check.name === 'lint' ? { ...check, conclusion: 'failure' as const } : check,
      ),
    };
    expect(refusedWith(failed)).toEqual(['checks_not_green']);
  });

  it('SR-1 with no required checks needs every check that ran to pass and at least one to have run', () => {
    const open = { ...green(), requiredChecks: [] };
    expect(refusedWith(open)).toEqual([]);
    expect(refusedWith({ ...open, checks: [] })).toEqual(['checks_not_green']);
    const codecov = {
      name: 'codecov',
      app: 'codecov',
      headSha: 'abc123',
      conclusion: 'failure' as const,
    };
    expect(refusedWith({ ...open, checks: [...green().checks, codecov] })).toEqual([
      'checks_not_green',
    ]);
  });

  it('SR-1 counts a required check only from its own app', () => {
    const impostor = green().checks.map((check) =>
      check.name === 'lint' ? { ...check, app: 'someone-else' } : check,
    );
    expect(refusedWith({ ...green(), checks: impostor })).toEqual(['required_check_never_ran']);
  });

  it('GD-2 refuses harness_frozen while the harness is frozen for this item', () => {
    expect(refusedWith({ ...green(), frozen: true })).toEqual(['harness_frozen']);
  });
});

describe('SR-2 the ship rule counts a carried approval and a carried expected head', () => {
  const merged = 'def456';
  const atMerged = (carries: string[]): ShipRuleInput => ({
    ...onPullRequest({ head: merged }),
    carries,
    checks: green().checks.map((check) => ({ ...check, headSha: merged })),
  });

  it('advances on a head carried from the approved, expected head', () => {
    const carried = atMerged(['abc123']);
    expect(shipRule(carried)).toEqual({ verdict: 'advance' });
    expect(countedApprovals(carried)).toEqual([
      { reviewer: 'reviewer-openrouter', commit: 'abc123', head: merged },
    ]);
  });

  it('refuses head_mismatch and counts no approval when nothing is carried', () => {
    const moved = atMerged([]);
    expect(refusedWith(moved)).toEqual(['head_mismatch', 'no_reviewer_approval']);
    expect(countedApprovals(moved)).toEqual([]);
  });

  it('counts no approval without a pull request', () => {
    expect(countedApprovals({ ...green(), pullRequest: null })).toEqual([]);
  });
});

describe('MD-4 a delegation never covers a protected path or a tier above its own', () => {
  const lent = (maxTier: 'low' | 'standard', protectedTouched: string[] | null = []) => ({
    delegationId: '00000000-0000-4000-8000-0000000000d1',
    maxTier,
    protectedTouched,
  });
  const standard = (): ShipRuleInput => ({ ...green(), riskTier: 'standard', riskDomains: [] });

  it('MD-4 advances a standard change under a standard delegation that touches no protected path', () => {
    expect(shipRule({ ...standard(), delegation: lent('standard') })).toEqual({
      verdict: 'advance',
    });
  });

  it('MD-4 refuses tier_above_delegation for a standard change under a low delegation', () => {
    expect(refusedWith({ ...standard(), delegation: lent('low') })).toEqual([
      'tier_above_delegation',
    ]);
  });

  it('MD-4 refuses protected_path_needs_person when the change touches one', () => {
    const touched = { ...standard(), delegation: lent('standard', ['src/billing/rates.ts']) };
    expect(refusedWith(touched)).toEqual(['protected_path_needs_person']);
  });

  it('MD-4 fails closed when the changed paths are unknown', () => {
    expect(refusedWith({ ...standard(), delegation: lent('standard', null) })).toEqual([
      'protected_path_needs_person',
    ]);
  });

  it('MD-4 a high change under a standard delegation is above its tier', () => {
    const high = { ...standard(), riskTier: 'high' as const, delegation: lent('standard') };
    expect(refusedWith(high)).toContain('tier_above_delegation');
  });

  it('MD-4 a person approval carries no delegation and is refused for neither', () => {
    const reasons = refusedWith({ ...standard(), riskTier: 'high', delegation: null });
    expect(reasons).not.toContain('tier_above_delegation');
    expect(reasons).not.toContain('protected_path_needs_person');
  });
});
