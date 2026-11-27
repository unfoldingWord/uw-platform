import { describe, expect, it } from 'vitest';
import {
  ASSISTANT_RETENTION_DAYS,
  assistantRedactionWhySchema,
  assistantUndoRefusalSchema,
  customiseAssistantCommandSchema,
  deleteMyAssistantHistoryCommandSchema,
  renewAssistCommandSchema,
  revokeAssistCommandSchema,
  undoAssistantEffectCommandSchema,
} from './assistant-history.ts';
import { eventEvidenceSchemas } from './event-evidence.ts';
import { eventNameSchema } from './events.ts';
import { errorReasonSchema } from './outcomes.ts';
import { platformCommandNameSchema } from './platform-commands.ts';

const requestId = '00000000-0000-4000-8000-0000000000e7';
const effectId = '00000000-0000-4000-8000-0000000000e8';

describe('PA-7 the My Assistant commands', () => {
  it('customises only the display name, the instructions and the timezone, at a version', () => {
    const body = {
      command: 'customise_assistant',
      requestId,
      displayName: 'Barnabas',
      instructionsMd: 'Keep it short.',
      timezone: 'Africa/Nairobi',
      expectedVersion: 1,
    };
    expect(customiseAssistantCommandSchema.safeParse(body).success).toBe(true);
    expect(customiseAssistantCommandSchema.safeParse({ ...body, model: 'x' }).success).toBe(false);
    expect(customiseAssistantCommandSchema.safeParse({ ...body, displayName: '' }).success).toBe(
      false,
    );
  });

  it('renews, revokes and undoes for the person only, naming no person', () => {
    const renew = { command: 'renew_assist', requestId, expiresAt: null };
    expect(renewAssistCommandSchema.safeParse(renew).success).toBe(true);
    expect(renewAssistCommandSchema.safeParse({ ...renew, personId: requestId }).success).toBe(
      false,
    );
    expect(
      revokeAssistCommandSchema.safeParse({ command: 'revoke_assist', requestId }).success,
    ).toBe(true);
    const undo = { command: 'undo_assistant_effect', requestId, effectId };
    expect(undoAssistantEffectCommandSchema.safeParse(undo).success).toBe(true);
    const wipe = { command: 'delete_my_assistant_history', requestId };
    expect(deleteMyAssistantHistoryCommandSchema.safeParse(wipe).success).toBe(true);
    for (const name of [
      'customise_assistant',
      'renew_assist',
      'revoke_assist',
      'undo_assistant_effect',
      'delete_my_assistant_history',
    ]) {
      expect(platformCommandNameSchema.safeParse(name).success).toBe(true);
    }
  });
});

describe('PA-7 the My Assistant refusals', () => {
  it('names the refusals the screen shows in place', () => {
    for (const reason of [
      'assistant_name_invalid',
      'assistant_name_reserved',
      'effect_not_undoable',
    ]) {
      expect(errorReasonSchema.safeParse(reason).success).toBe(true);
    }
    expect([...assistantUndoRefusalSchema.options]).toEqual([
      'not_undoable',
      'already_closed',
      'hold_ended',
    ]);
  });
});

describe('PA-15 retention', () => {
  it('keeps request text and replies one year', () => {
    expect(ASSISTANT_RETENTION_DAYS).toBe(365);
    expect([...assistantRedactionWhySchema.options]).toEqual(['retention', 'person']);
  });

  it('records an undo and a redaction with ids, counts and closed values only', () => {
    for (const name of ['assistant_effect_undone', 'assistant_history_redacted']) {
      expect(eventNameSchema.safeParse(name).success).toBe(true);
    }
    const undone = eventEvidenceSchemas.assistant_effect_undone;
    expect(undone.safeParse({ effectId, kind: 'reminder_set' }).success).toBe(true);
    expect(undone.safeParse({ effectId, kind: 'reminder_set', text: 'x' }).success).toBe(false);
    const redacted = eventEvidenceSchemas.assistant_history_redacted;
    expect(redacted.safeParse({ why: 'person', requests: 3 }).success).toBe(true);
    expect(redacted.safeParse({ why: 'person', requests: -1 }).success).toBe(false);
    expect(redacted.safeParse({ why: 'because', requests: 1 }).success).toBe(false);
  });
});
