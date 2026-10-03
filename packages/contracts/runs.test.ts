import { describe, expect, it } from 'vitest';
import { runFailureSchema, runStopSchema } from './closed-sets.ts';
import { eventEvidenceSchemas } from './event-evidence.ts';
import { eventSchema } from './events.ts';
import {
  modelIdSchema,
  providerIdSchema,
  reviewRecordSchema,
  runStepRecordSchema,
} from './runs.ts';
import { recordRunStepReplySchema, verbIo } from './verb-io.ts';

const runId = '00000000-0000-4000-8000-0000000000a1';
const base = {
  eventId: '00000000-0000-4000-8000-0000000000a2',
  harnessId: '00000000-0000-4000-8000-0000000000a3',
  itemId: '00000000-0000-4000-8000-0000000000a4',
  position: 1,
  at: '2026-10-03T09:00:00.000Z',
  actor: 'agent:builder',
  traceId: '00000000-0000-4000-8000-0000000000a5',
  requestId: null,
};

describe('run events carry closed-set evidence', () => {
  it('names why a run hibernated, stopped, failed and how it ended', () => {
    const parse = (name: string, evidence: object) =>
      eventSchema.safeParse({ ...base, name, evidence }).success;
    expect(parse('run_hibernated', { runId, why: 'gate' })).toBe(true);
    expect(parse('run_hibernated', { runId, why: 'nap' })).toBe(false);
    expect(parse('run_resumed', { runId, why: 'breaker' })).toBe(true);
    expect(parse('run_stopped', { runId, why: 'stopped_by_person' })).toBe(true);
    expect(
      parse('run_failed', { runId, step: 'work', why: 'retries_exhausted', detail: null }),
    ).toBe(true);
    expect(
      parse('run_completed', { runId, result: 'decided', gates: ['ship'], review: null }),
    ).toBe(true);
    expect(parse('run_completed', { runId, result: 'merged', gates: [], review: null })).toBe(
      false,
    );
    expect(parse('run_prompted', { runId, message: 'look at the tests first' })).toBe(true);
    expect(parse('run_prompted', { runId, message: '' })).toBe(false);
  });

  it('records the persona, run shape, engine and model a run started on', () => {
    const started = {
      runId,
      persona: 'agent:builder',
      runShape: 'workflow-run',
      engine: 'openrouter-messages',
      model: 'z-ai/glm-5.3-flash',
      delegationId: null,
    };
    expect(eventSchema.safeParse({ ...base, name: 'run_started', evidence: started }).success).toBe(
      true,
    );
    const unknownEngine = { ...started, engine: 'gpt' };
    expect(
      eventSchema.safeParse({ ...base, name: 'run_started', evidence: unknownEngine }).success,
    ).toBe(false);
  });
});

describe('run reasons and older steps', () => {
  it('has one lease-loss reason, a run stopped lease_expired', () => {
    expect(runStopSchema.options).toContain('lease_expired');
    expect(runFailureSchema.options.filter((why) => why.startsWith('lease'))).toEqual([]);
  });

  it('reads an older run_step_recorded without costs with null costs', () => {
    const evidence = eventEvidenceSchemas.run_step_recorded.parse({
      runId,
      step: 'read',
      tokensIn: 0,
      tokensOut: 0,
      costBasis: 'metered',
      leaseExpiresAt: '2026-10-03T09:15:00.000Z',
    });
    expect(evidence).toMatchObject({
      costMinor: null,
      computeMinor: null,
      model: null,
      resolvedProvider: null,
      toolsCalled: [],
      writes: 0,
    });
  });
});

describe('record_run_step takes optional costs and answers prompts', () => {
  it('defaults every cost field on a step that reports only tokens', () => {
    const input = verbIo.record_run_step.input.parse({
      itemId: base.itemId,
      runId,
      step: 'work',
      tokensIn: 10,
      tokensOut: 2,
      costBasis: 'subscription',
    });
    expect(input).toMatchObject({
      costMinor: null,
      computeMinor: null,
      model: null,
      resolvedProvider: null,
      toolsCalled: [],
      writes: 0,
    });
    expect(Object.keys(verbIo.record_run_step.output.shape)).toContain('prompts');
  });

  it('caps the prompts a reply carries at twenty of 4,000 characters', () => {
    const reply = { leaseExpiresAt: null, leaseWarning: false };
    expect(recordRunStepReplySchema.safeParse({ ...reply, prompts: ['x'] }).success).toBe(true);
    const many = Array.from({ length: 21 }, () => 'x');
    expect(recordRunStepReplySchema.safeParse({ ...reply, prompts: many }).success).toBe(false);
    const long = ['x'.repeat(4001)];
    expect(recordRunStepReplySchema.safeParse({ ...reply, prompts: long }).success).toBe(false);
  });

  it('refuses a negative cost and an unknown tool', () => {
    const step = { step: 'work', tokensIn: 1, tokensOut: 1, at: base.at };
    expect(runStepRecordSchema.safeParse({ ...step, costMinor: 3 }).success).toBe(true);
    expect(runStepRecordSchema.safeParse({ ...step, costMinor: -1 }).success).toBe(false);
    expect(runStepRecordSchema.safeParse({ ...step, toolsCalled: ['merge'] }).success).toBe(false);
  });
});

describe('a provider id is a slug', () => {
  it('accepts lowercase slugs and refuses display names', () => {
    expect(providerIdSchema.safeParse('deepinfra').success).toBe(true);
    expect(providerIdSchema.safeParse('DeepInfra').success).toBe(false);
    expect(providerIdSchema.safeParse('deep infra').success).toBe(false);
  });

  it('records the reviewer, provider, model and verdict of a posted review', () => {
    const record = {
      reviewer: 'uw-reviewer',
      provider: 'z-ai',
      model: 'glm',
      verdict: 'approve',
      reviewId: 7,
    };
    expect(reviewRecordSchema.safeParse(record).success).toBe(true);
    expect(reviewRecordSchema.safeParse({ ...record, verdict: 'merge' }).success).toBe(false);
  });
});

describe('run text fields are narrow', () => {
  const runId = '00000000-0000-4000-8000-0000000000a1';

  it('takes a model id of the model charset and refuses newlines, spaces and markup', () => {
    expect(modelIdSchema.safeParse('z-ai/glm-5.3-flash').success).toBe(true);
    expect(modelIdSchema.safeParse('anthropic:claude-opus@2026+beta').success).toBe(true);
    for (const forged of ['glm\nflash', 'glm flash', '<b>glm</b>', '', 'm'.repeat(201)]) {
      expect(modelIdSchema.safeParse(forged).success, forged).toBe(false);
    }
    const step = { step: 'work', tokensIn: 1, tokensOut: 1, at: base.at };
    expect(runStepRecordSchema.safeParse({ ...step, model: 'glm\nflash' }).success).toBe(false);
    const started = {
      runId,
      persona: 'agent:builder',
      runShape: 'workflow-run',
      engine: 'claude-messages',
      model: 'claude opus',
      delegationId: null,
    };
    expect(eventSchema.safeParse({ ...base, name: 'run_started', evidence: started }).success).toBe(
      false,
    );
  });

  it('keeps a failure detail to one printable line', () => {
    const failed = (detail: string | null) =>
      eventSchema.safeParse({
        ...base,
        name: 'run_failed',
        evidence: { runId, step: 'work', why: 'provider_mismatch', detail },
      }).success;
    expect(failed('z-ai/deepinfra')).toBe(true);
    expect(failed(null)).toBe(true);
    expect(failed('first\nsecond')).toBe(false);
    expect(failed('bell\u0007')).toBe(false);
    expect(failed('x'.repeat(501))).toBe(false);
  });
});

describe('review ids and step input keys', () => {
  const runId = '00000000-0000-4000-8000-0000000000a1';

  it('refuses a review id below one', () => {
    const record = {
      reviewer: 'uw-reviewer',
      provider: 'z-ai',
      model: 'glm',
      verdict: 'approve',
      reviewId: 1,
    };
    expect(reviewRecordSchema.safeParse(record).success).toBe(true);
    expect(reviewRecordSchema.safeParse({ ...record, reviewId: 0 }).success).toBe(false);
    expect(reviewRecordSchema.safeParse({ ...record, reviewId: -7 }).success).toBe(false);
  });

  it('refuses a record_run_step input key it does not name', () => {
    const input = {
      itemId: base.itemId,
      runId,
      step: 'work',
      tokensIn: 1,
      tokensOut: 1,
      costBasis: 'subscription',
    };
    expect(verbIo.record_run_step.input.safeParse(input).success).toBe(true);
    expect(verbIo.record_run_step.input.safeParse({ ...input, cost_minor: 4 }).success).toBe(false);
  });
});
