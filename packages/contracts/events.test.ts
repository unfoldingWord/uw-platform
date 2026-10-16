import { describe, expect, it } from 'vitest';
import { eventEvidenceSchemas } from './event-evidence.ts';
import { eventNameSchema, eventSchema, newEventSchema } from './events.ts';

function without(body: Record<string, unknown>, key: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(body).filter(([name]) => name !== key));
}

const base = {
  eventId: '00000000-0000-4000-8000-0000000000e1',
  harnessId: '00000000-0000-4000-8000-0000000000a1',
  itemId: '00000000-0000-4000-8000-0000000000b1',
  position: 1,
  at: '2026-10-01T09:00:00.000Z',
  actor: 'agent:builder',
  traceId: '00000000-0000-4000-8000-0000000000c1',
};

const claimed = {
  ...base,
  name: 'item_claimed',
  evidence: {
    holder: 'agent:builder',
    claimantKind: 'agent',
    delegationId: null,
    leaseExpiresAt: '2026-10-01T09:15:00.000Z',
  },
};

describe('KN-3 the event vocabulary is PRD section 8.6', () => {
  it('has the sixty-three names and none of the placeholders it replaces', () => {
    expect(eventNameSchema.options).toHaveLength(67);
    expect(eventNameSchema.safeParse('stage_edited').success).toBe(true);
    expect(eventNameSchema.options[0]).toBe('item_created');
    expect(eventNameSchema.options.at(-1)).toBe('template_changed');
    expect(eventNameSchema.safeParse('abandoned').success).toBe(false);
    expect(eventNameSchema.safeParse('branch_abandoned').success).toBe(true);
  });

  it('types evidence only for names in the vocabulary', () => {
    for (const name of Object.keys(eventEvidenceSchemas)) {
      expect(eventNameSchema.safeParse(name).success).toBe(true);
    }
  });
});

const stageEdited = {
  ...base,
  itemId: null,
  name: 'stage_edited',
  evidence: {
    stageId: '00000000-0000-4000-8000-0000000000d1',
    key: 'review',
    before: { exitGate: 'checks' },
    after: { exitGate: 'human_approval' },
  },
};

describe('KN-3 stage_edited evidence carries the stage and only the columns the edit changed', () => {
  it('accepts an update with before and after, and a creation with no before', () => {
    expect(eventSchema.safeParse(stageEdited).success).toBe(true);
    const created = {
      ...stageEdited,
      evidence: { ...stageEdited.evidence, before: null, after: { title: 'Review', position: 30 } },
    };
    expect(eventSchema.safeParse(created).success).toBe(true);
  });

  it('refuses a column that is not a stage column and a changed id', () => {
    const unknown = {
      ...stageEdited,
      evidence: { ...stageEdited.evidence, after: { colour: 'red' } },
    };
    const id = {
      ...stageEdited,
      evidence: { ...stageEdited.evidence, after: { id: base.eventId } },
    };
    expect(eventSchema.safeParse(unknown).success).toBe(false);
    expect(eventSchema.safeParse(id).success).toBe(false);
  });
});

describe('KN-3 every event row carries harness, item, name, actor, evidence, trace id and position', () => {
  it('accepts a well-formed claim', () => {
    expect(eventSchema.safeParse(claimed).success).toBe(true);
  });

  it('refuses evidence that does not fit its name', () => {
    const wrong = { ...claimed, evidence: { claimantKind: 'agent' } };
    expect(eventSchema.safeParse(wrong).success).toBe(false);
  });

  it('refuses a position below one and an unknown name', () => {
    expect(eventSchema.safeParse({ ...claimed, position: 0 }).success).toBe(false);
    expect(eventSchema.safeParse({ ...claimed, name: 'merged' }).success).toBe(false);
  });

  it('has no position before the store assigns one', () => {
    const { position, ...unpositioned } = claimed;
    expect(position).toBe(1);
    expect(newEventSchema.safeParse(unpositioned).success).toBe(true);
    expect(newEventSchema.safeParse(claimed).success).toBe(false);
  });
});

const reordered = {
  ...base,
  name: 'item_reordered',
  evidence: { priority: 30, before: null },
};

describe('KN-3 item_reordered and stage_removed carry what changed', () => {
  it('takes an integer priority and the item placed before, or null', () => {
    expect(eventSchema.safeParse(reordered).success).toBe(true);
    const before = { ...reordered, evidence: { priority: 30, before: base.itemId } };
    expect(eventSchema.safeParse(before).success).toBe(true);
    const fractional = { ...reordered, evidence: { priority: 1.5, before: null } };
    expect(eventSchema.safeParse(fractional).success).toBe(false);
  });

  it('needs the removed stage and its columns', () => {
    const removed = {
      ...base,
      itemId: null,
      name: 'stage_removed',
      evidence: {
        stageId: '00000000-0000-4000-8000-0000000000d1',
        key: 'review',
        before: { title: 'Review', position: 30 },
      },
    };
    expect(eventSchema.safeParse(removed).success).toBe(true);
    const withoutBefore = without(removed.evidence, 'before');
    expect(eventSchema.safeParse({ ...removed, evidence: withoutBefore }).success).toBe(false);
  });
});

describe('an event carries the requestId of the command that appended it, or null', () => {
  it('reads an event without a requestId as null', () => {
    const parsed = eventSchema.parse(claimed);
    expect(parsed.requestId).toBeNull();
  });

  it('takes a uuid requestId and refuses any other string', () => {
    const requestId = '00000000-0000-4000-8000-0000000000f1';
    expect(eventSchema.parse({ ...claimed, requestId }).requestId).toBe(requestId);
    expect(eventSchema.safeParse({ ...claimed, requestId: 'x' }).success).toBe(false);
  });
});

describe('breaker, switch, premise and activation evidence', () => {
  const parse = (name: string, evidence: object) =>
    eventSchema.safeParse({ ...base, itemId: null, name, evidence }).success;

  it('needs the spend reading on every breaker event', () => {
    const reading = { spentMinor: 94_000, capMinor: 125_000, currency: 'USD', percent: 75 };
    for (const name of ['breaker_holding', 'breaker_pausing', 'breaker_open']) {
      expect(parse(name, reading), name).toBe(true);
      expect(parse(name, without(reading, 'percent')), name).toBe(false);
    }
    expect(parse('breaker_holding', { ...reading, capMinor: 0 })).toBe(false);
    expect(parse('breaker_holding', { ...reading, currency: 'usd' })).toBe(false);
  });

  it('needs enabled on hosted_builder_set', () => {
    expect(parse('hosted_builder_set', { enabled: true })).toBe(true);
    expect(parse('hosted_builder_set', {})).toBe(false);
  });

  it('needs a run id or null and a one-line reason on premise_held', () => {
    const runId = '00000000-0000-4000-8000-0000000000f2';
    expect(parse('premise_held', { runId, reason: 'the issue is already fixed' })).toBe(true);
    expect(parse('premise_held', { runId: null, reason: 'no scout verdict' })).toBe(true);
    expect(parse('premise_held', { runId, reason: 'two\nlines' })).toBe(false);
    expect(parse('premise_held', { runId })).toBe(false);
  });

  it('takes a persona activation that failed on its engine, with no verb', () => {
    const evidence = {
      pageId: '00000000-0000-4000-8000-0000000000d2',
      persona: 'agent:builder',
      verb: null,
      engine: 'claude-managed-agent',
      reason: 'engine_not_available',
      message: 'engine claude-managed-agent is not available',
      itemId: null,
    };
    expect(parse('persona_activation_failed', evidence)).toBe(true);
    const older = { ...evidence, verb: 'read_page', reason: 'unknown_verb' };
    const parsed = eventEvidenceSchemas.persona_activation_failed.parse(without(older, 'engine'));
    expect(parsed.engine).toBeNull();
  });
});

describe('hand-off, measurement, activation and attachment evidence', () => {
  const parse = (name: string, evidence: object) =>
    eventSchema.safeParse({ ...base, name, evidence }).success;
  const personId = '00000000-0000-4000-8000-0000000000f3';
  const pageId = '00000000-0000-4000-8000-0000000000d3';

  it('names the person, the reason and the round count on handed_to_person', () => {
    const evidence = { personId, why: 'review_rounds_exhausted', rounds: 3 };
    expect(parse('handed_to_person', evidence)).toBe(true);
    expect(parse('handed_to_person', { ...evidence, why: 'tired' })).toBe(false);
    expect(parse('handed_to_person', { ...evidence, rounds: 0 })).toBe(false);
    expect(parse('handed_to_person', without(evidence, 'personId'))).toBe(false);
  });

  it('carries the source, name, value and date on measurement_recorded', () => {
    const evidence = {
      measurementId: '00000000-0000-4000-8000-0000000000f4',
      source: 'web_analytics',
      name: 'weekly visitors',
      value: 412.5,
      asOf: '2026-10-01',
    };
    expect(parse('measurement_recorded', evidence)).toBe(true);
    expect(parse('measurement_recorded', { ...evidence, source: 'survey' })).toBe(false);
    expect(parse('measurement_recorded', { ...evidence, name: '' })).toBe(false);
    expect(parse('measurement_recorded', { ...evidence, extra: 1 })).toBe(false);
  });

  it('names the page, the persona and the new version on persona_activated', () => {
    const evidence = { pageId, persona: 'agent:iterate', version: 2 };
    expect(parse('persona_activated', evidence)).toBe(true);
    expect(parse('persona_activated', { ...evidence, version: 0 })).toBe(false);
    expect(parse('persona_activated', { ...evidence, persona: 'human:ian' })).toBe(false);
    expect(parse('persona_activated', { ...evidence, extra: true })).toBe(false);
  });

  it('reads a learning attachment without a kind as a learning and takes a revision', () => {
    const parsed = eventEvidenceSchemas.learning_attached.parse({ pageId });
    expect(parsed.kind).toBe('learning');
    expect(parse('learning_attached', { pageId, kind: 'revision' })).toBe(true);
    expect(parse('learning_attached', { pageId, kind: 'draft' })).toBe(false);
  });
});

describe('a dry run failure', () => {
  it('is a persona activation refusal', () => {
    const evidence = {
      pageId: '00000000-0000-4000-8000-0000000000d3',
      persona: 'agent:iterate',
      verb: null,
      engine: null,
      reason: 'dry_run_failed',
      message: 'persona iterate failed its dry run turn',
      itemId: null,
    };
    const event = { ...base, itemId: null, name: 'persona_activation_failed', evidence };
    expect(eventSchema.safeParse(event).success).toBe(true);
  });
});
