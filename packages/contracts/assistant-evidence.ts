import { z } from 'zod';
import {
  assistantChannelSchema,
  assistantEffectFailureSchema,
  assistantEffectKindSchema,
  assistantSettingFieldSchema,
  assistantTurnRefusalSchema,
} from './assistants.ts';
import { verbNameSchema } from './verb-names.ts';

const id = z.uuid();
const count = z.number().int().min(0);

export const assistantEvidence = {
  assistant_customised: z.strictObject({
    fields: z.array(assistantSettingFieldSchema).min(1).max(3),
  }),
  assistant_request_recorded: z.strictObject({
    requestId: id,
    channel: assistantChannelSchema,
  }),
  assistant_turn_started: z.strictObject({
    requestId: id,
    turnId: id,
    personaVersion: z.number().int().min(1),
  }),
  assistant_turn_refused: z.strictObject({
    requestId: id,
    why: assistantTurnRefusalSchema,
  }),
  assistant_turn_finished: z.strictObject({
    requestId: id,
    turnId: id,
    outcome: z.enum(['ended', 'turn_limit', 'refused']),
    turns: count,
    inputTokens: count,
    outputTokens: count,
    costMicros: count.nullable(),
    tools: z.array(verbNameSchema).max(100),
  }),
  assistant_effect_started: z.strictObject({
    effectId: id,
    requestId: id,
    kind: assistantEffectKindSchema,
  }),
  assistant_effect_done: z.strictObject({
    effectId: id,
    kind: assistantEffectKindSchema,
  }),
  assistant_effect_failed: z.strictObject({
    effectId: id,
    kind: assistantEffectKindSchema,
    why: assistantEffectFailureSchema,
  }),
};
