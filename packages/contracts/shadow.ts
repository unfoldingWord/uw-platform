import { z } from 'zod';
import { reviewVerdictSchema } from './closed-sets.ts';
import { pullRequestRefSchema } from './harness.ts';
import { slugSchema } from './pages.ts';
import { fullShaSchema, shipRefusalSchema } from './ship-rule.ts';

export const shadowVerdictValueSchema = z.enum(['advance', 'refuse']);

const shadowSchema = z.strictObject({
  verdict: shadowVerdictValueSchema,
  reasons: z.array(shipRefusalSchema).max(shipRefusalSchema.options.length),
});

const recordedSchema = z.strictObject({
  reviewer: z.string().regex(/^[a-z0-9-]{1,64}$/),
  verdict: reviewVerdictSchema,
  findings: z.array(z.string().min(1).max(500)).max(50),
});

const otherReviewSchema = z.strictObject({
  reviewer: z.string().min(1).max(100),
  state: z.enum(['approved', 'changes_requested', 'dismissed']),
});

export const shadowRowSchema = z.strictObject({
  itemId: z.uuid(),
  title: z.string().min(1).max(200),
  pullRequest: pullRequestRefSchema,
  head: fullShaSchema,
  shadow: shadowSchema.nullable(),
  reviewer: recordedSchema.nullable(),
  github: z.array(otherReviewSchema).max(100),
  disagrees: z.boolean(),
});

export const shadowComparisonSchema = z.strictObject({
  harnessId: z.uuid(),
  harnessKey: slugSchema,
  shadow: z.boolean(),
  capped: z.boolean(),
  rows: z.array(shadowRowSchema).max(5000),
});

export type ShadowRow = z.infer<typeof shadowRowSchema>;
export type ShadowComparison = z.infer<typeof shadowComparisonSchema>;
