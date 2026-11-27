import { z } from 'zod';
import { jdAreaSchema } from './areas.ts';
import { pageStatusSchema } from './pages.ts';
import {
  countryCodeSchema,
  impactStoryFrontmatterSchema,
  regionCodeSchema,
  sensitivityLevelSchema,
  storyUseSchema,
} from './stories.ts';
import {
  consentStateSchema,
  expressionFieldsSchema,
  expressionFormatSchema,
  flagCountsSchema,
  storyConsentShownSchema,
  storyExpressionSchema,
} from './story-expressions.ts';

const programShownSchema = z.strictObject({ id: z.uuid(), title: z.string().min(1) });

export const storyRecordSchema = z.strictObject({
  id: z.uuid(),
  title: z.string().min(1),
  jdArea: jdAreaSchema,
  status: pageStatusSchema,
  version: z.number().int().min(1),
  record: impactStoryFrontmatterSchema,
  programs: z.array(programShownSchema),
  level: sensitivityLevelSchema,
  consent: storyConsentShownSchema,
  expressions: z.array(
    z.strictObject({
      format: expressionFormatSchema,
      expressions: z.array(storyExpressionSchema).min(1),
    }),
  ),
  uses: z.array(storyUseSchema),
  flags: flagCountsSchema,
});

export const storySummarySchema = z.strictObject({
  id: z.uuid(),
  title: z.string().min(1),
  jdArea: jdAreaSchema,
  status: pageStatusSchema,
  occurredOn: z.iso.date().nullable(),
  place: z.string().min(1).nullable(),
  country: countryCodeSchema.nullable(),
  region: regionCodeSchema.nullable(),
  programs: z.array(z.uuid()),
  level: sensitivityLevelSchema,
  consent: consentStateSchema,
  expressionCount: z.number().int().min(0),
  formats: z.array(expressionFormatSchema),
  lastToldOn: z.iso.date().nullable(),
  flags: flagCountsSchema,
});

export type StoryRecord = z.infer<typeof storyRecordSchema>;
export type StorySummary = z.infer<typeof storySummarySchema>;

export const listStoriesInputSchema = z.strictObject({
  query: z.string().trim().min(1).max(200).nullable().default(null),
  program: z.uuid().nullable().default(null),
  country: countryCodeSchema.nullable().default(null),
  formatPresent: expressionFormatSchema.nullable().default(null),
  formatAbsent: expressionFormatSchema.nullable().default(null),
  limit: z.number().int().min(1).max(100).default(50),
});

export type ListStoriesInput = z.infer<typeof listStoriesInputSchema>;

const expressionReplySchema = z.strictObject({
  expressionId: z.uuid(),
  created: z.boolean(),
  status: storyExpressionSchema.shape.status,
  flags: storyExpressionSchema.shape.flags,
});

export const storyVerbIo = {
  add_story_expression: {
    input: expressionFieldsSchema.extend({ storyId: z.uuid() }),
    output: expressionReplySchema,
  },
  update_story_expression: {
    input: expressionFieldsSchema.extend({ expressionId: z.uuid() }),
    output: expressionReplySchema,
  },
  read_story: {
    input: z.strictObject({ storyId: z.uuid() }),
    output: z.strictObject({ story: storyRecordSchema }),
  },
  list_stories: {
    input: listStoriesInputSchema,
    output: z.strictObject({ stories: z.array(storySummarySchema) }),
  },
} as const;
