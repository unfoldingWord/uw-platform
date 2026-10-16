import { describe, expect, it } from 'vitest';
import { approveAtSchema, runFailureSchema } from './closed-sets.ts';
import { commandSchema } from './commands.ts';
import { eventEvidenceSchemas } from './event-evidence.ts';
import { harnessSchema } from './harness.ts';
import { errorReasonSchema } from './outcomes.ts';
import { personaFrontmatterSchema } from './page-types.ts';
import { reviewFindingSchema, reviewRecordSchema } from './runs.ts';
import { defaultCiChecks, shipRefusalSchema, shipRuleInputSchema } from './ship-rule.ts';

const requestId = '00000000-0000-4000-8000-0000000000aa';
const itemId = '00000000-0000-4000-8000-0000000000b1';
const head = 'a'.repeat(40);

describe('SR-1 SR-2 the contracts for the ship rule', () => {
  it('SR-1 appends five ship refusals, each also an error reason', () => {
    const added = [
      'base_behind',
      'auto_close_keyword',
      'skip_ci_marker',
      'required_check_never_ran',
      'harness_frozen',
    ];
    expect(shipRefusalSchema.options.slice(-5)).toEqual(added);
    for (const reason of added) expect(errorReasonSchema.options).toContain(reason);
    expect(errorReasonSchema.options).toContain('finding_weight_missing');
  });

  it('SR-1 names the six CI jobs as the default required checks of github-actions', () => {
    expect(defaultCiChecks.map((check) => check.app)).toEqual(Array(6).fill('github-actions'));
    expect(defaultCiChecks).toHaveLength(6);
  });

  it('SR-1 SR-2 needs every new ship-rule input', () => {
    const input = {
      pullRequest: { open: true, draft: false, head, behindBy: 0, skipCi: false },
      expectedHead: head,
      carries: [],
      checks: [{ name: 'lint', app: 'github-actions', headSha: head, conclusion: 'success' }],
      requiredChecks: [{ app: 'github-actions', name: 'lint' }],
      approvals: [],
      closes: [],
      wraps: null,
      riskTier: 'standard',
      riskDomains: [],
      area: '80-89',
      approver: {
        identity: 'human:00000000-0000-4000-8000-000000000001',
        kind: 'person',
        personId: '00000000-0000-4000-8000-000000000001',
        email: 'ian@unfoldingword.org',
        grants: [],
        interactive: true,
      },
      at: '2026-10-15T09:00:00.000Z',
      frozen: false,
      override: false,
    };
    expect(shipRuleInputSchema.safeParse(input).success).toBe(true);
    const unfrozen = Object.fromEntries(Object.entries(input).filter(([key]) => key !== 'frozen'));
    expect(shipRuleInputSchema.safeParse(unfrozen).success).toBe(false);
  });
});

describe('GD-1 GD-2 GD-3 the contracts for gates and the freeze', () => {
  it('GD-2 SR-1 reads an older harness row as unfrozen with no required checks', () => {
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
      frozen: false,
      freezeAllow: [],
      requiredChecks: [],
    });
  });

  it('GD-2 sets a freeze with its allow list and lifts it only with an empty list', () => {
    const set = { command: 'set_freeze', requestId, frozen: true, allow: [itemId] };
    expect(commandSchema.safeParse(set).success).toBe(true);
    expect(commandSchema.safeParse({ ...set, frozen: false }).success).toBe(false);
    expect(commandSchema.safeParse({ ...set, frozen: false, allow: [] }).success).toBe(true);
    expect(commandSchema.safeParse({ ...set, allow: [itemId, itemId] }).success).toBe(false);
  });

  it('GD-1 decides a batch of one to fifty pinned entries, each item once', () => {
    const entry = { itemId, head, decision: 'approve' };
    const batch = { command: 'decide_gates', requestId, entries: [entry] };
    expect(commandSchema.safeParse(batch).success).toBe(true);
    expect(commandSchema.safeParse({ ...batch, entries: [] }).success).toBe(false);
    expect(commandSchema.safeParse({ ...batch, entries: [entry, entry] }).success).toBe(false);
    expect(
      commandSchema.safeParse({ ...batch, entries: [{ ...entry, decision: 'override' }] }).success,
    ).toBe(false);
  });

  it('GD-3 fails a run engine_refused and hands it over with no round count', () => {
    expect(runFailureSchema.options).toContain('engine_refused');
    const handed = eventEvidenceSchemas.handed_to_person;
    const personId = '00000000-0000-4000-8000-000000000001';
    expect(handed.safeParse({ personId, why: 'engine_refused', rounds: null }).success).toBe(true);
    expect(handed.safeParse({ personId, why: 'engine_refused', rounds: 1 }).success).toBe(false);
    expect(
      handed.safeParse({ personId, why: 'review_rounds_exhausted', rounds: null }).success,
    ).toBe(false);
  });
});

describe('RV-1 RV-2 RV-3 the contracts for findings', () => {
  it('RV-1 requires a weight on every finding of a Reviewer verdict', () => {
    expect(
      reviewFindingSchema.safeParse({ text: 'The lease is late.', weight: 'real' }).success,
    ).toBe(true);
    expect(reviewFindingSchema.safeParse({ text: 'The lease is late.' }).success).toBe(false);
    const record = {
      reviewer: 'uw-reviewer',
      provider: 'deepinfra',
      model: 'z-ai/glm-5.3',
      verdict: 'approve',
      reviewId: null,
    };
    expect(reviewRecordSchema.parse(record)).toMatchObject({ findings: [] });
    expect(runFailureSchema.options).toContain('finding_weight_missing');
  });

  it('RV-2 refutes one finding of one run by index', () => {
    const refute = {
      command: 'refute_finding',
      requestId,
      itemId,
      runId: '00000000-0000-4000-8000-0000000000d1',
      finding: 0,
    };
    expect(commandSchema.safeParse(refute).success).toBe(true);
    expect(commandSchema.safeParse({ ...refute, finding: 50 }).success).toBe(false);
  });

  it('RV-3 defaults the strictness preset to no_real_or_plausible', () => {
    expect(approveAtSchema.options).toEqual(['zero_findings', 'no_real_or_plausible']);
    const page = {
      identity: 'agent:reviewer',
      owner: 'human:00000000-0000-4000-8000-000000000001',
      harness: '00000000-0000-4000-8000-0000000000a1',
      toolset: ['read_page'],
      run_shape: 'workflow-run',
      engine: 'openrouter-messages',
      model: 'z-ai/glm-5.3-flash',
      budget: { monthly_minor: 0, currency: 'USD' },
      capability: 'review',
    };
    expect(personaFrontmatterSchema.parse(page)).toMatchObject({
      approve_at: 'no_real_or_plausible',
    });
  });
});
