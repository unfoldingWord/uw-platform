import { z } from 'zod';
import { jdCategorySchema } from './areas.ts';

export const sensitivityLevels = [
  'internal',
  'private_circulation',
  'newsletter',
  'public',
] as const;

export const renderChannels = ['platform', 'private_circulation', 'newsletter', 'public'] as const;

export const nameUses = ['real', 'pseudonym', 'none'] as const;

export const locationPrecisions = ['country', 'region', 'none'] as const;

export const consentForms = ['written', 'audio', 'video', 'witnessed_verbal'] as const;

export const storyUseKinds = ['markdown_export', 'pdf_page', 'pdf_binder', 'agent_read'] as const;

export const sensitivityLevelSchema = z.enum(sensitivityLevels);
export const renderChannelSchema = z.enum(renderChannels);
export const nameUseSchema = z.enum(nameUses);
export const locationPrecisionSchema = z.enum(locationPrecisions);
export const consentFormSchema = z.enum(consentForms);
export const storyUseKindSchema = z.enum(storyUseKinds);

export type SensitivityLevel = z.infer<typeof sensitivityLevelSchema>;
export type RenderChannel = z.infer<typeof renderChannelSchema>;
export type StoryUseKind = z.infer<typeof storyUseKindSchema>;
export type LocationPrecision = z.infer<typeof locationPrecisionSchema>;

const levelRank: ReadonlyMap<string, number> = new Map(
  sensitivityLevels.map((level, rank) => [level, rank]),
);
const channelRank: ReadonlyMap<string, number> = new Map(
  renderChannels.map((channel, rank) => [channel, rank]),
);

export function storyMayAppear(level: SensitivityLevel, channel: RenderChannel): boolean {
  return (levelRank.get(level) ?? -1) >= (channelRank.get(channel) ?? Number.POSITIVE_INFINITY);
}

export function levelsShownIn(channel: RenderChannel): readonly SensitivityLevel[] {
  return sensitivityLevels.filter((level) => storyMayAppear(level, channel));
}

export function raisesLevel(from: SensitivityLevel, to: SensitivityLevel): boolean {
  return (levelRank.get(to) ?? 0) > (levelRank.get(from) ?? 0);
}

const userAssignedCountry = /^(?:AA|Q[M-Z]|X[A-Z]|ZZ)$/;
const regionNames = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' });

export function isCountryCode(code: string): boolean {
  if (!/^[A-Z]{2}$/.test(code)) return false;
  return userAssignedCountry.test(code) || regionNames.of(code) !== undefined;
}

export function isLanguageTag(tag: string): boolean {
  try {
    return Intl.getCanonicalLocales(tag).length === 1;
  } catch {
    return false;
  }
}

const distinct = <T>(values: readonly T[]) => new Set(values).size === values.length;
const label = z
  .string()
  .max(60)
  .refine((value) => value.trim().length > 0, 'a theme is not blank');

const placeSchema = z
  .string()
  .max(120)
  .refine((value) => value.trim().length > 0, 'a place is not blank');

export const countryCodeSchema = z.string().refine(isCountryCode, 'an ISO 3166-1 alpha-2 code');
export const regionCodeSchema = z
  .string()
  .regex(/^[A-Z]{2}-[A-Z0-9]{1,3}$/, 'an ISO 3166-2 code such as XA-01');
export const languageTagSchema = z
  .string()
  .max(35)
  .refine(isLanguageTag, 'a BCP 47 language tag or an ISO 639-3 code');

export const impactStoryFrontmatterSchema = z
  .strictObject({
    jd_category: jdCategorySchema,
    country: countryCodeSchema.nullable().default(null),
    region: regionCodeSchema.nullable().default(null),
    languages: z
      .array(languageTagSchema)
      .max(20)
      .refine(distinct, 'each language once')
      .default([]),
    illustrates: z.array(z.uuid()).max(50).refine(distinct, 'each page once').default([]),
    themes: z.array(label).max(20).refine(distinct, 'each theme once').default([]),
    occurred_on: z.iso.date().nullable().default(null),
    place: placeSchema.nullable().default(null),
    programs: z.array(z.uuid()).max(20).refine(distinct, 'each program once').default([]),
  })
  .refine(
    (value) => value.region === null || value.region.startsWith(`${value.country ?? ''}-`),
    'a region code starts with its country code',
  );

export type ImpactStoryFrontmatter = z.infer<typeof impactStoryFrontmatterSchema>;

const day = z.iso.date();
const reference = z.string().trim().min(1).max(500);

export const setStoryLevelCommandSchema = z.strictObject({
  command: z.literal('set_story_level'),
  requestId: z.uuid(),
  pageId: z.uuid(),
  level: sensitivityLevelSchema,
});

export const recordStoryConsentCommandSchema = z.strictObject({
  command: z.literal('record_story_consent'),
  requestId: z.uuid(),
  pageId: z.uuid(),
  consentReference: reference,
  consentedBy: z.string().trim().min(1).max(200),
  consentForm: consentFormSchema,
  consentedOn: day,
  consentExpires: day.nullable(),
  anonymised: z.boolean(),
  nameUse: nameUseSchema,
  locationPrecision: locationPrecisionSchema,
  photoRelease: z.boolean(),
  photoReference: reference.nullable(),
  reviewOn: day.nullable(),
});

export const withdrawStoryConsentCommandSchema = z.strictObject({
  command: z.literal('withdraw_story_consent'),
  requestId: z.uuid(),
  pageId: z.uuid(),
});

export const setStoryMediaLevelCommandSchema = z.strictObject({
  command: z.literal('set_story_media_level'),
  requestId: z.uuid(),
  pageId: z.uuid(),
  fileId: z.uuid(),
  level: sensitivityLevelSchema,
});

export const storyCommandSchemas = {
  set_story_level: setStoryLevelCommandSchema,
  record_story_consent: recordStoryConsentCommandSchema,
  withdraw_story_consent: withdrawStoryConsentCommandSchema,
  set_story_media_level: setStoryMediaLevelCommandSchema,
} as const;

export const storyUseSchema = z.strictObject({
  pageId: z.uuid(),
  version: z.number().int().min(1),
  channel: renderChannelSchema,
  kind: storyUseKindSchema,
  reference: z.string().min(1).max(500),
  usedBy: z.string().min(1),
  usedAt: z.iso.datetime(),
});

export type SetStoryLevelCommand = z.infer<typeof setStoryLevelCommandSchema>;
export type RecordStoryConsentCommand = z.infer<typeof recordStoryConsentCommandSchema>;
export type WithdrawStoryConsentCommand = z.infer<typeof withdrawStoryConsentCommandSchema>;
export type SetStoryMediaLevelCommand = z.infer<typeof setStoryMediaLevelCommandSchema>;
export type StoryUse = z.infer<typeof storyUseSchema>;
