import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { CONTRACT_VERSION, assertLiveContractVersion } from './version.ts';
import { schemaRegistry } from './registry.ts';
import { identitySchema } from './identity.ts';
import { commandSchema, templateKeySchema } from './commands.ts';
import { outcomeSchema } from './outcomes.ts';
import { eventNameSchema } from './events.ts';
import * as closedSets from './closed-sets.ts';
import * as contracts from './index.ts';
import { jdAreaSchema } from './areas.ts';
import { errorReasonSchema } from './outcomes.ts';
import { principalSchema } from './principal.ts';
import { eventEvidenceSchemas } from './event-evidence.ts';
import { harnessSchema } from './harness.ts';
import { pageTypeSchema } from './pages.ts';
import { platformFrontmatterSchema } from './page-types.ts';
import { shadowComparisonSchema } from './shadow.ts';
import { submitToGateResultSchema } from './verb-io.ts';

const fixtureRoot = join(import.meta.dirname, 'fixtures');

function without(body: Record<string, unknown>, key: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(body).filter(([name]) => name !== key));
}

function loadFixtures(schemaName: string, kind: 'valid' | 'invalid'): [string, unknown][] {
  const dir = join(fixtureRoot, schemaName, kind);
  return readdirSync(dir).map((file) => [
    `${schemaName}/${kind}/${file}`,
    JSON.parse(readFileSync(join(dir, file), 'utf8')),
  ]);
}

describe('golden fixtures', () => {
  for (const [name, schema] of Object.entries(schemaRegistry)) {
    const valid = loadFixtures(name, 'valid');
    const invalid = loadFixtures(name, 'invalid');

    it(`${name} has at least one valid and one invalid fixture`, () => {
      expect(valid.length).toBeGreaterThan(0);
      expect(invalid.length).toBeGreaterThan(0);
    });

    it.each(valid)('%s round-trips through parse and serialise', (_label, fixture) => {
      const parsed = schema.parse(fixture);
      expect(JSON.parse(JSON.stringify(parsed))).toEqual(fixture);
    });

    it.each(invalid)('%s is rejected with a Zod error', (_label, fixture) => {
      const result = schema.safeParse(fixture);
      expect(result.success).toBe(false);
      expect(result.error).toBeInstanceOf(z.ZodError);
    });
  }

  it('registers every exported schema', () => {
    const registered = new Set(Object.values(schemaRegistry));
    const unregistered = Object.entries(contracts)
      .filter(([, value]) => value instanceof z.ZodType && !registered.has(value))
      .map(([name]) => name);
    expect(unregistered).toEqual([]);
  });

  it('has a fixture directory only for registered schemas', () => {
    expect(readdirSync(fixtureRoot).sort()).toEqual(Object.keys(schemaRegistry).sort());
  });
});

describe('contract version', () => {
  it('exports one semver version', () => {
    expect(CONTRACT_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('accepts the live version', () => {
    expect(() => assertLiveContractVersion(CONTRACT_VERSION)).not.toThrow();
  });

  it('refuses a stale version', () => {
    expect(() => assertLiveContractVersion('0.0.1')).toThrow(/stale/);
  });
});

describe('identity strings', () => {
  it.each([
    'human:ian',
    'agent:claude',
    'agent:jesse/laptop-1',
    'agent:jesse/laptop-1 as reviewer via delegation:d-42',
  ])('accepts %s', (value) => {
    expect(identitySchema.safeParse(value).success).toBe(true);
  });

  it.each([
    '',
    'human:',
    'human:a/b',
    'robot:x',
    'agent:jesse/laptop-1 as reviewer',
    'agent:jesse as reviewer via delegation:d-42',
    'human:ian as reviewer via delegation:d-42',
  ])('rejects %j', (value) => {
    expect(identitySchema.safeParse(value).success).toBe(false);
  });
});

describe('commands and outcomes', () => {
  it('refuses a command without a requestId', () => {
    expect(commandSchema.safeParse({ command: 'pause' }).success).toBe(false);
  });

  it('requires a reason, the item and the seen head on override', () => {
    const base = {
      command: 'override',
      requestId: '3f1d7c1e-8c53-4a53-9d6e-0a9b6a0f4d11',
      itemId: '00000000-0000-4000-8000-0000000000bb',
      head: 'a'.repeat(40),
    };
    expect(commandSchema.safeParse(base).success).toBe(false);
    expect(commandSchema.safeParse({ ...base, reason: 'ok' }).success).toBe(true);
    const body = { ...base, reason: 'ok' };
    expect(commandSchema.safeParse(without(body, 'itemId')).success).toBe(false);
    expect(commandSchema.safeParse(without(body, 'head')).success).toBe(false);
  });

  it('carries a reason that says a command is not wired', () => {
    const outcome = outcomeSchema.parse({
      status: 'error',
      requestId: '3f1d7c1e-8c53-4a53-9d6e-0a9b6a0f4d11',
      reason: 'not_wired',
    });
    expect(outcome.status === 'error' && outcome.reason).toBe('not_wired');
  });
});

describe('closed sets', () => {
  it('holds the values the spec names', () => {
    expect(closedSets.connectorSchema.options).toEqual([
      'none',
      'merge',
      'deploy',
      'publish',
      'send',
      'post',
    ]);
    expect(closedSets.exitGateSchema.options).toEqual(['none', 'checks', 'human_approval']);
    expect(closedSets.agentPickupSchema.options).toEqual(['none', 'allowed', 'auto']);
    expect(closedSets.riskTierSchema.options).toEqual(['low', 'standard', 'high']);
    expect(closedSets.riskDomainSchema.options).toEqual(['ledger', 'acl', 'infra', 'migration']);
    expect(closedSets.evidenceLabelSchema.options).toEqual([
      'observed',
      'confirmed',
      'inferred',
      'assumed',
    ]);
    expect(closedSets.roleSchema.options).toEqual(['admin', 'editor', 'viewer']);
    expect(closedSets.scopeSchema.options).toEqual(['org', 'jd_area']);
    expect(closedSets.classificationSchema.options).toEqual([
      'public',
      'internal',
      'restricted',
      'sensitive',
    ]);
    expect(closedSets.offlineEligibilitySchema.options).toEqual([
      'sync',
      'cache_readonly',
      'never',
    ]);
    expect(closedSets.runShapeSchema.options).toEqual(['workflow-run', 'external-run']);
    expect(closedSets.engineSchema.options).toEqual([
      'claude-messages',
      'claude-code-sandbox',
      'claude-managed-agent',
      'codex-sandbox',
      'external',
      'openrouter-messages',
    ]);
    expect(closedSets.costBasisSchema.options).toEqual(['metered', 'subscription']);
  });
});

describe('closed sets of the principal and the gate', () => {
  it('holds the capability, gate, person and principal sets', () => {
    expect(closedSets.capabilityWordSchema.options).toEqual([
      'none',
      'iterate',
      'build',
      'review',
      'merge',
      'fix',
    ]);
    expect(closedSets.gateDecisionSchema.options).toEqual([
      'approve',
      'reject',
      'take_over',
      'override',
    ]);
    expect(closedSets.personStatusSchema.options).toEqual(['active', 'pending']);
    expect(closedSets.principalKindSchema.options).toEqual(['person', 'agent']);
  });
});

describe('closed sets added for v0.2.0', () => {
  it('holds the finding weights and the untrusted sources the design names', () => {
    expect(closedSets.findingWeightSchema.options).toEqual(['real', 'plausible', 'theoretical']);
    expect(closedSets.untrustedSourceSchema.options).toEqual([
      'pr_diff',
      'issue_body',
      'review_comment',
      'page_from_agent',
      'pr_title',
    ]);
  });

  it('names the check-only template', () => {
    expect(templateKeySchema.options).toEqual(['software', 'bml', 'check-only']);
  });

  it('still refuses a capability word outside the set on a delegation grant', () => {
    const grant = {
      command: 'schedule_regular_tweak',
      requestId: '3f1d7c1e-8c53-4a53-9d6e-0a9b6a0f4d11',
      persona: 'agent:builder',
      capability: 'deploy',
      expiresAt: '2026-10-16T00:00:00.000Z',
      supersedes: null,
    };
    expect(commandSchema.safeParse(grant).success).toBe(false);
    expect(commandSchema.safeParse({ ...grant, capability: 'merge' }).success).toBe(true);
  });
});

describe('refusal reasons and events', () => {
  it('names the spec refusal reasons and events', () => {
    const reasons = [
      'risk_tier_undeclared',
      'reviewer_count_below_tier',
      'approver_lacks_domain_grant',
      'delegation_required',
    ];
    for (const reason of reasons) {
      expect(
        outcomeSchema.safeParse({
          status: 'error',
          requestId: '3f1d7c1e-8c53-4a53-9d6e-0a9b6a0f4d11',
          reason,
        }).success,
      ).toBe(true);
    }
    for (const name of [
      'gate_approved',
      'lease_expired',
      'delegation_lapsed',
      'branch_abandoned',
    ]) {
      expect(eventNameSchema.safeParse(name).success).toBe(true);
    }
    expect(eventNameSchema.safeParse('abandoned').success).toBe(false);
  });
});

const shipRuleReasons = [
  'pr_not_open',
  'pr_is_draft',
  'head_mismatch',
  'checks_not_green',
  'no_reviewer_approval',
  'risk_tier_undeclared',
  'reviewer_count_below_tier',
  'reviewer_providers_not_distinct',
  'approver_lacks_domain_grant',
];

function personFixture(): unknown {
  const [first] = loadFixtures('principal', 'valid');
  return first?.[1];
}

describe('FD-7 FD-8 the principal and grants as contract data', () => {
  it('round-trips a person principal through JSON, as a queue message carries it', () => {
    const principal = principalSchema.parse(personFixture());
    expect(principalSchema.parse(JSON.parse(JSON.stringify(principal)))).toEqual(principal);
  });

  it('refuses a JD area whose two decades differ', () => {
    expect(jdAreaSchema.safeParse('80-89').success).toBe(true);
    expect(jdAreaSchema.safeParse('80-19').success).toBe(false);
  });

  it('accepts every decade from 00-09 to 90-99', () => {
    const areas = Array.from({ length: 10 }, (_, digit) => `${digit}0-${digit}9`);
    expect(areas.filter((area) => !jdAreaSchema.safeParse(area).success)).toEqual([]);
  });

  it('carries the PRD section 8.5 reasons in order, ship rule first', () => {
    expect(errorReasonSchema.options.slice(0, 9)).toEqual(shipRuleReasons);
    expect(errorReasonSchema.options).not.toContain('command_not_wired');
  });
});

describe('package purity', () => {
  it('depends only on zod at runtime and imports no node or Workers module', () => {
    const manifest = JSON.parse(readFileSync(join(import.meta.dirname, 'package.json'), 'utf8'));
    expect(Object.keys(manifest.dependencies)).toEqual(['zod']);
    const sources = readdirSync(import.meta.dirname).filter(
      (file) => file.endsWith('.ts') && !file.endsWith('.test.ts'),
    );
    for (const file of sources) {
      const text = readFileSync(join(import.meta.dirname, file), 'utf8');
      expect(text, file).not.toMatch(/from ['"](node:|cloudflare:|@cloudflare)/);
    }
  });
});

const requestId = '00000000-0000-4000-8000-0000000000aa';
const head = 'a'.repeat(40);

describe('GL-2 GL-4 the contracts for shadow and refusals', () => {
  it('names the four refusals joining and dispatch need', () => {
    for (const reason of [
      'template_has_no_package',
      'no_harness_for_repo',
      'repository_not_dispatchable',
      'dispatch_list_unavailable',
    ] as const) {
      expect(errorReasonSchema.options).toContain(reason);
    }
  });

  it('lifts shadow and never sets it on a live harness', () => {
    const lift = { command: 'set_shadow', requestId, shadow: false };
    expect(commandSchema.safeParse(lift).success).toBe(true);
    expect(commandSchema.safeParse({ ...lift, shadow: true }).success).toBe(false);
  });

  it('reads an older harness row as not in shadow with no external reviewers', () => {
    const older = {
      id: '00000000-0000-4000-8000-0000000000a1',
      key: 'software',
      template: 'software',
      jdArea: '80-89',
      repository: 'unfoldingWord/uw-platform',
      hostedBuilderEnabled: false,
      paused: false,
    };
    expect(harnessSchema.parse(older)).toMatchObject({
      shadow: false,
      externalReviewerIdentities: [],
    });
  });
});

describe('GL-3 the contracts for a joined pull request', () => {
  it('carries a joined pull request and its head on item_created, together or not at all', () => {
    const created = {
      stage: 'check',
      title: 'Fix the login form',
      pageId: null,
      priority: 0,
      due: null,
    };
    const pullRequest = { repo: 'unfoldingWord/tc-admin-app', number: 12 };
    const schema = eventEvidenceSchemas.item_created;
    expect(schema.parse(created)).toMatchObject({ pullRequest: null, expectedHead: null });
    expect(schema.safeParse({ ...created, pullRequest, expectedHead: head }).success).toBe(true);
    expect(schema.safeParse({ ...created, pullRequest, expectedHead: null }).success).toBe(false);
  });
});

describe('OB-3 the shadow comparison', () => {
  it('bounds a shadow comparison row', () => {
    const row = {
      itemId: '00000000-0000-4000-8000-0000000000b1',
      title: 'Fix the login form',
      pullRequest: { repo: 'unfoldingWord/tc-admin-app', number: 12 },
      head,
      shadow: { verdict: 'refuse', reasons: ['checks_not_green'] },
      reviewer: { reviewer: 'uw-reviewer', verdict: 'approve', findings: [] },
      github: [{ reviewer: 'uwreview[bot]', state: 'changes_requested' }],
      disagrees: true,
    };
    const comparison = {
      harnessId: '00000000-0000-4000-8000-0000000000a1',
      harnessKey: 'tc-admin-app',
      shadow: true,
      capped: false,
      rows: [row],
    };
    expect(shadowComparisonSchema.safeParse(comparison).success).toBe(true);
    const commented = { ...row, github: [{ reviewer: 'x', state: 'commented' }] };
    expect(shadowComparisonSchema.safeParse({ ...comparison, rows: [commented] }).success).toBe(
      false,
    );
  });
});

describe('PI-1 the contracts for external reviewers at activation', () => {
  it('activates a harness in shadow with external reviewers, and defaults both off', () => {
    const base = {
      command: 'activate_template',
      requestId,
      harnessKey: 'tc-admin-app',
      jdArea: '80-89',
      template: 'check-only',
      repository: 'unfoldingWord/tc-admin-app',
    };
    expect(commandSchema.parse(base)).toMatchObject({
      shadow: false,
      externalReviewerIdentities: [],
    });
    const shadowed = { ...base, shadow: true, externalReviewerIdentities: ['uwreview[bot]'] };
    expect(commandSchema.safeParse(shadowed).success).toBe(true);
    const twice = { ...base, externalReviewerIdentities: ['uwreview[bot]', 'UWReview[bot]'] };
    expect(commandSchema.safeParse(twice).success).toBe(false);
  });
});

describe('GL-6 the contracts for the platform page', () => {
  it('knows the platform page type and its dispatch list', () => {
    expect(pageTypeSchema.options).toContain('platform');
    const list = { dispatch_allowed: ['unfoldingWord/tc-admin-app'] };
    expect(platformFrontmatterSchema.safeParse(list).success).toBe(true);
    const repeated = { dispatch_allowed: ['unfoldingWord/a', 'UNFOLDINGWORD/A'] };
    expect(platformFrontmatterSchema.safeParse(repeated).success).toBe(false);
  });
});

describe('FL-1 FL-2 FL-3 FL-4 the fix claim contracts', () => {
  const requestId = '3f1d7c1e-8c53-4a53-9d6e-0a9b6a0f4d11';
  const delegationId = '00000000-0000-4000-8000-0000000000f1';
  const head = 'c'.repeat(40);

  it('FL-1 a harness starts with the fix claim off, and an admin command switches it', () => {
    const older = {
      id: delegationId,
      key: 'tc-admin-app',
      template: 'software',
      jdArea: '80-89',
      repository: 'unfoldingWord/tc-admin-app',
      hostedBuilderEnabled: false,
      paused: false,
    };
    expect(harnessSchema.parse(older)).toMatchObject({ fixClaim: false });
    expect(harnessSchema.parse({ ...older, fixClaim: true })).toMatchObject({ fixClaim: true });
    const command = { command: 'set_fix_claim', requestId, enabled: true };
    expect(commandSchema.parse(command)).toEqual(command);
    expect(commandSchema.safeParse({ command: 'set_fix_claim', requestId }).success).toBe(false);
    expect(eventEvidenceSchemas.fix_claim_set.parse({ enabled: false })).toEqual({
      enabled: false,
    });
  });

  it('FL-2 a fix claim records its delegation, its start head and the declaration', () => {
    const claimed = { delegationId, head, declaration: null };
    expect(eventEvidenceSchemas.fix_claimed.parse(claimed)).toEqual(claimed);
    const declared = {
      ...claimed,
      declaration: {
        closes: ['#12'],
        risks: 'the board renders slower on phones',
        touches: 'apps/uw-app/board',
        riskTier: 'standard',
        riskDomains: [],
      },
    };
    expect(eventEvidenceSchemas.fix_claimed.parse(declared)).toEqual(declared);
    expect(eventEvidenceSchemas.fix_claimed.safeParse({ ...claimed, head: 'abc' }).success).toBe(
      false,
    );
  });

  it('FL-3 a fix is refused with its own reasons, and a passing fix waits for review', () => {
    expect(errorReasonSchema.options).toContain('fix_size_cap');
    expect(errorReasonSchema.options).toContain('fix_keeps_purpose');
    expect(submitToGateResultSchema.options.at(-1)).toBe('awaiting_review');
  });

  it('FL-4 a run that ran no declared checks fails checks_not_run_locally', () => {
    expect(closedSets.runFailureSchema.options.at(-1)).toBe('checks_not_run_locally');
  });
});
