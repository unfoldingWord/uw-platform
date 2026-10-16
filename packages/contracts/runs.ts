import { z } from 'zod';
import { findingWeightSchema, reviewVerdictSchema } from './closed-sets.ts';
import { verbNameSchema } from './verb-names.ts';

export const runStepSchema = z.enum(['read', 'scout', 'work', 'submit']);

export const providerIdSchema = z.string().regex(/^[a-z0-9._-]{1,64}$/);
export type ProviderId = z.infer<typeof providerIdSchema>;

const minor = z.number().int().min(0);
export const modelIdSchema = z.string().regex(/^[A-Za-z0-9._:/@+-]{1,200}$/);
export type ModelId = z.infer<typeof modelIdSchema>;

const model = modelIdSchema;

const findingText = z.string().min(1).max(500);
export const reviewFindingSchema = z.strictObject({
  text: findingText,
  weight: findingWeightSchema,
});
export const readFindingSchema = z.strictObject({
  text: findingText,
  weight: findingWeightSchema.nullable(),
});
export type ReviewFinding = z.infer<typeof reviewFindingSchema>;
export type ReadFinding = z.infer<typeof readFindingSchema>;

export const reviewRecordSchema = z.strictObject({
  reviewer: z.string().regex(/^[a-z0-9-]{1,64}$/),
  provider: providerIdSchema,
  model,
  verdict: reviewVerdictSchema,
  reviewId: z.number().int().min(1).nullable(),
  findings: z.array(reviewFindingSchema).max(50).default([]),
});
export type ReviewRecord = z.infer<typeof reviewRecordSchema>;

export const runStepCosts = {
  costMinor: minor.nullable().default(null),
  computeMinor: minor.nullable().default(null),
  model: model.nullable().default(null),
  resolvedProvider: providerIdSchema.nullable().default(null),
  toolsCalled: z.array(verbNameSchema).max(200).default([]),
  writes: z.number().int().min(0).max(10_000).default(0),
};

export const runStepRecordSchema = z.strictObject({
  step: runStepSchema,
  tokensIn: minor,
  tokensOut: minor,
  ...runStepCosts,
  at: z.iso.datetime(),
});
export type RunStepRecord = z.infer<typeof runStepRecordSchema>;
