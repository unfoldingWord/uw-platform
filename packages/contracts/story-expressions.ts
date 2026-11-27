import { z } from 'zod';
import {
  consentFormSchema,
  languageTagSchema,
  locationPrecisionSchema,
  nameUseSchema,
  renderChannelSchema,
  storyUseSchema,
} from './stories.ts';

export const expressionFormats = [
  'social_post',
  'newsletter_article',
  'annual_report',
  'web_page',
  'blog_post',
  'video',
  'audio',
  'presentation',
  'grant_report',
  'board_report',
  'email',
  'print',
  'other',
] as const;

export const expressionStatuses = ['suggested', 'confirmed', 'retired'] as const;

export const expressionKinds = ['link', 'native'] as const;

export const expressionFlags = ['told_above_level', 'told_without_consent'] as const;

export const consentStates = ['none', 'recorded', 'expired', 'withdrawn'] as const;

export const EXPRESSION_EXCERPT_MOST = 1000;
export const EXPRESSION_URL_MOST = 2000;

export const expressionFormatSchema = z.enum(expressionFormats);
export const expressionStatusSchema = z.enum(expressionStatuses);
export const expressionKindSchema = z.enum(expressionKinds);
export const expressionFlagSchema = z.enum(expressionFlags);
export const consentStateSchema = z.enum(consentStates);

export type ExpressionFormat = z.infer<typeof expressionFormatSchema>;
export type ExpressionStatus = z.infer<typeof expressionStatusSchema>;
export type ExpressionFlag = z.infer<typeof expressionFlagSchema>;
export type ConsentState = z.infer<typeof consentStateSchema>;

const httpsUrl = z.url({ protocol: /^https$/, hostname: /^[^.\s][^\s]*$/, normalize: true });
const credentials = /^https:\/\/[^/?#]*@/;

export function expressionUrl(raw: string): string | null {
  const parsed = httpsUrl.safeParse(raw.trim());
  if (!parsed.success) return null;
  const [kept = ''] = parsed.data.split('#');
  if (credentials.test(kept) || kept.length > EXPRESSION_URL_MOST) return null;
  return kept;
}

const words = (most: number) => z.string().trim().min(1).max(most);

const day = z.iso.date();

export const expressionFieldsSchema = z.strictObject({
  title: words(300),
  format: expressionFormatSchema,
  venue: words(120),
  channel: renderChannelSchema,
  url: words(EXPRESSION_URL_MOST),
  language: languageTagSchema.nullable(),
  publishedOn: day.nullable(),
  excerpt: words(EXPRESSION_EXCERPT_MOST).nullable(),
});

export type ExpressionFields = z.infer<typeof expressionFieldsSchema>;

export function expressionFieldsOf(given: ExpressionFields): ExpressionFields {
  const { title, format, venue, channel, url, language, publishedOn, excerpt } = given;
  return { title, format, venue, channel, url, language, publishedOn, excerpt };
}

export const addStoryExpressionCommandSchema = expressionFieldsSchema.extend({
  command: z.literal('add_story_expression'),
  requestId: z.uuid(),
  pageId: z.uuid(),
});

export const updateStoryExpressionCommandSchema = expressionFieldsSchema.extend({
  command: z.literal('update_story_expression'),
  requestId: z.uuid(),
  expressionId: z.uuid(),
});

export const confirmStoryExpressionCommandSchema = z.strictObject({
  command: z.literal('confirm_story_expression'),
  requestId: z.uuid(),
  expressionId: z.uuid(),
});

export const retireStoryExpressionCommandSchema = z.strictObject({
  command: z.literal('retire_story_expression'),
  requestId: z.uuid(),
  expressionId: z.uuid(),
});

export const storyExpressionCommandSchemas = {
  add_story_expression: addStoryExpressionCommandSchema,
  update_story_expression: updateStoryExpressionCommandSchema,
  confirm_story_expression: confirmStoryExpressionCommandSchema,
  retire_story_expression: retireStoryExpressionCommandSchema,
} as const;

export type AddStoryExpressionCommand = z.infer<typeof addStoryExpressionCommandSchema>;
export type UpdateStoryExpressionCommand = z.infer<typeof updateStoryExpressionCommandSchema>;
export type ConfirmStoryExpressionCommand = z.infer<typeof confirmStoryExpressionCommandSchema>;
export type RetireStoryExpressionCommand = z.infer<typeof retireStoryExpressionCommandSchema>;

const instant = z.iso.datetime();

export const storyExpressionSchema = z.strictObject({
  id: z.uuid(),
  storyId: z.uuid(),
  kind: expressionKindSchema,
  title: z.string().min(1).max(300),
  format: expressionFormatSchema,
  venue: z.string().min(1).max(120),
  channel: renderChannelSchema,
  url: z.string().min(1).max(EXPRESSION_URL_MOST).nullable(),
  nativePageId: z.uuid().nullable(),
  language: z.string().min(1).max(35).nullable(),
  publishedOn: day.nullable(),
  excerpt: z.string().min(1).max(EXPRESSION_EXCERPT_MOST).nullable(),
  status: expressionStatusSchema,
  addedBy: z.string().min(1),
  addedAt: instant,
  decidedBy: z.string().min(1).nullable(),
  decidedAt: instant.nullable(),
  flags: z.array(expressionFlagSchema),
});

export type StoryExpression = z.infer<typeof storyExpressionSchema>;

export const withdrawalReportSchema = z.strictObject({
  status: z.literal('accepted'),
  requestId: z.uuid(),
  uses: z.array(storyUseSchema),
  expressions: z.array(storyExpressionSchema),
});

export type WithdrawalReport = z.infer<typeof withdrawalReportSchema>;

export const consentRecordShownSchema = z.strictObject({
  consentReference: z.string().min(1),
  consentedBy: z.string().min(1),
  consentForm: consentFormSchema,
  consentedOn: day,
  consentExpires: day.nullable(),
  anonymised: z.boolean(),
  nameUse: nameUseSchema,
  locationPrecision: locationPrecisionSchema,
  photoRelease: z.boolean(),
  photoReference: z.string().min(1).nullable(),
  reviewOn: day.nullable(),
});

export const storyConsentShownSchema = z.strictObject({
  state: consentStateSchema,
  record: consentRecordShownSchema.nullable(),
});

export const flagCountsSchema = z.strictObject({
  toldAboveLevel: z.number().int().min(0),
  toldWithoutConsent: z.number().int().min(0),
});

export type FlagCounts = z.infer<typeof flagCountsSchema>;
