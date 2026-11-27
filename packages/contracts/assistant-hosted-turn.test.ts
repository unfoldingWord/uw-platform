import { describe, expect, it } from 'vitest';
import { assistantTurnOutcomeSchema, assistantTurnRefusalSchema } from './assistants.ts';
import { eventEvidenceSchemas } from './event-evidence.ts';
import { eventNameSchema } from './events.ts';
import { platformCommandNameSchema } from './platform-commands.ts';
import { schemaRegistry } from './registry.ts';
import { setAssistantBudgetCommandSchema } from './assistant-commands.ts';

const id = '00000000-0000-4000-8000-0000000000e1';
const other = '00000000-0000-4000-8000-0000000000e2';

const finished = {
  requestId: id,
  turnId: other,
  turns: 0,
  inputTokens: 0,
  outputTokens: 0,
  costMicros: null,
  tools: [],
};

describe('PA-16 the assistants spend pool contracts', () => {
  it('refuses a turn with assistants_capped once the pool is spent', () => {
    expect(assistantTurnRefusalSchema.safeParse('assistants_capped').success).toBe(true);
  });

  it('records a budget change with its amount and never more', () => {
    expect(eventNameSchema.safeParse('assistant_budget_set').success).toBe(true);
    const set = eventEvidenceSchemas.assistant_budget_set;
    expect(set.safeParse({ monthlyMinor: 2500 }).success).toBe(true);
    expect(set.safeParse({ monthlyMinor: null }).success).toBe(true);
    expect(set.safeParse({ monthlyMinor: -1 }).success).toBe(false);
    expect(set.safeParse({ monthlyMinor: 1_000_001 }).success).toBe(false);
    expect(set.safeParse({ monthlyMinor: 2500, personId: id }).success).toBe(false);
  });

  it('names set_assistant_budget as a platform command for one person', () => {
    expect(platformCommandNameSchema.safeParse('set_assistant_budget').success).toBe(true);
    const command = {
      command: 'set_assistant_budget',
      requestId: id,
      personId: other,
      monthlyMinor: 5000,
    };
    expect(setAssistantBudgetCommandSchema.safeParse(command).success).toBe(true);
    const cleared = { ...command, monthlyMinor: null };
    expect(setAssistantBudgetCommandSchema.safeParse(cleared).success).toBe(true);
    const fraction = { ...command, monthlyMinor: 12.5 };
    expect(setAssistantBudgetCommandSchema.safeParse(fraction).success).toBe(false);
    expect(schemaRegistry['set-assistant-budget-command']).toBe(setAssistantBudgetCommandSchema);
  });
});

describe('PA-17 the hosted turn contracts', () => {
  it('closes the turn outcomes, a failed loop and an abandoned turn included', () => {
    expect([...assistantTurnOutcomeSchema.options]).toEqual([
      'ended',
      'turn_limit',
      'refused',
      'failed',
      'abandoned',
    ]);
    expect(schemaRegistry['assistant-turn-outcome']).toBe(assistantTurnOutcomeSchema);
  });

  it('accepts a failed or abandoned finish and nothing outside the set', () => {
    const evidence = eventEvidenceSchemas.assistant_turn_finished;
    expect(evidence.safeParse({ ...finished, outcome: 'failed' }).success).toBe(true);
    expect(evidence.safeParse({ ...finished, outcome: 'abandoned' }).success).toBe(true);
    expect(evidence.safeParse({ ...finished, outcome: 'crashed' }).success).toBe(false);
  });
});
