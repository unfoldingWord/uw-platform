import { z } from 'zod';
import { stageKeySchema, stageSchema } from './harness.ts';

export const DRAFT_STAGE_LIMIT = 50;

export const draftStageSchema = stageSchema
  .omit({ harnessId: true, position: true, paused: true })
  .extend({
    id: z.uuid().nullable(),
    title: z.string().max(120),
    wipLimit: z.number().int().min(0).max(1000),
    validators: stageSchema.shape.validators.pipe(z.array(z.string().max(100)).max(50)),
    feeds: stageSchema.shape.feeds.pipe(z.array(stageKeySchema).max(DRAFT_STAGE_LIMIT)),
  });

const draftProblemCodeSchema = z.enum([
  'no_stages',
  'title_blank',
  'key_repeated',
  'wip_limit_low',
  'unknown_loop_target',
  'unknown_validator',
  'connector_not_registered',
  'connector_needs_person',
  'bypasses_person',
  'effect_stage_removed',
  'stage_holds_items',
  'stage_has_history',
  'decision_in_flight',
]);

const draftProblemSchema = z.strictObject({
  stage: stageKeySchema.nullable(),
  code: draftProblemCodeSchema,
  message: z.string().min(1).max(500),
});

export const draftCheckSchema = z.strictObject({
  revision: z.number().int().min(1),
  problems: z.array(draftProblemSchema).max(500),
});

export type DraftStage = z.infer<typeof draftStageSchema>;
export type DraftProblemCode = z.infer<typeof draftProblemCodeSchema>;
export type DraftProblem = z.infer<typeof draftProblemSchema>;
export type DraftCheck = z.infer<typeof draftCheckSchema>;
