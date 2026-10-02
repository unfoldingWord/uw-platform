import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { CONTRACT_VERSION, assertLiveContractVersion } from './version.ts';
import { schemaRegistry } from './registry.ts';
import { identitySchema } from './identity.ts';
import { commandSchema } from './commands.ts';
import { outcomeSchema } from './outcomes.ts';
import { eventNameSchema } from './events.ts';
import * as closedSets from './closed-sets.ts';
import * as contracts from './index.ts';
import { jdAreaSchema } from './areas.ts';
import { errorReasonSchema } from './outcomes.ts';
import { principalSchema } from './principal.ts';

const fixtureRoot = join(import.meta.dirname, 'fixtures');

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

  it('requires a reason on override', () => {
    const requestId = '3f1d7c1e-8c53-4a53-9d6e-0a9b6a0f4d11';
    expect(commandSchema.safeParse({ command: 'override', requestId }).success).toBe(false);
    expect(commandSchema.safeParse({ command: 'override', requestId, reason: 'ok' }).success).toBe(
      true,
    );
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
    expect(closedSets.capabilityWordSchema.options).toEqual(['none', 'iterate', 'build', 'review']);
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
