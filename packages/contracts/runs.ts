import { z } from 'zod';
import { reviewVerdictSchema } from './closed-sets.ts';
import { verbNameSchema } from './verb-names.ts';

export const runStepSchema = z.enum(['read', 'scout', 'work', 'submit']);

export const providerIdSchema = z.string().regex(/^[a-z0-9._-]{1,64}$/);
export type ProviderId = z.infer<typeof providerIdSchema>;

const minor = z.number().int().min(0);
const model = z.string().min(1).max(200);

export const reviewRecordSchema = z.strictObject({
  reviewer: z.string().regex(/^[a-z0-9-]{1,64}$/),
  provider: providerIdSchema,
  model,
  verdict: reviewVerdictSchema,
  reviewId: z.number().int().nullable(),
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
