import { describe, expect, it } from 'vitest';
import { eventEvidenceSchemas } from './event-evidence.ts';
import { eventNameSchema, eventSchema, newEventSchema } from './events.ts';

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
  it('has the forty-five names and none of the placeholders it replaces', () => {
    expect(eventNameSchema.options).toHaveLength(45);
    expect(eventNameSchema.options[0]).toBe('item_created');
    expect(eventNameSchema.options.at(-1)).toBe('persona_activated');
    expect(eventNameSchema.safeParse('abandoned').success).toBe(false);
    expect(eventNameSchema.safeParse('branch_abandoned').success).toBe(true);
  });

  it('types evidence only for names in the vocabulary', () => {
    for (const name of Object.keys(eventEvidenceSchemas)) {
      expect(eventNameSchema.safeParse(name).success).toBe(true);
    }
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
