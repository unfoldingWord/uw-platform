import type {
  ExpressionFlag,
  ExpressionFormat,
  ExpressionStatus,
  LocationPrecision,
  RenderChannel,
  SensitivityLevel,
  StoryUseKind,
} from '@uw/contracts';
import type { ConsentShown } from '../../stories/reads.ts';

export const levelWords: Readonly<Record<SensitivityLevel, string>> = {
  internal: 'Internal',
  private_circulation: 'Private circulation',
  newsletter: 'Newsletter',
  public: 'Public',
};

export const channelWords: Readonly<Record<RenderChannel, string>> = {
  platform: 'Platform',
  private_circulation: 'Private circulation',
  newsletter: 'Newsletter',
  public: 'Public',
};

export const consentWords: Readonly<Record<ConsentShown['kind'], string>> = {
  none: 'None recorded',
  recorded: 'Recorded',
  expired: 'Expired',
  withdrawn: 'Withdrawn',
  withheld: 'Withheld from you',
};

export const useWords: Readonly<Record<StoryUseKind, string>> = {
  markdown_export: 'Markdown export',
  pdf_page: 'PDF of a page',
  pdf_binder: 'PDF binder',
  agent_read: 'Agent read',
};

export const nameUseWords: Readonly<Record<string, string>> = {
  real: 'Real name',
  pseudonym: 'Pseudonym',
  none: 'No name',
};

export const locationWords: Readonly<Record<string, string>> = {
  country: 'Country',
  region: 'Region',
  none: 'No location',
};

export const formWords: Readonly<Record<string, string>> = {
  written: 'Written',
  audio: 'Audio',
  video: 'Video',
  witnessed_verbal: 'Witnessed verbal',
};

export function wordFor(words: Readonly<Record<string, string>>, key: string): string {
  return new Map(Object.entries(words)).get(key) ?? key;
}

export const formatWords: Readonly<Record<ExpressionFormat, string>> = {
  social_post: 'Social post',
  newsletter_article: 'Newsletter article',
  annual_report: 'Annual report',
  web_page: 'Web page',
  blog_post: 'Blog post',
  video: 'Video',
  audio: 'Audio',
  presentation: 'Presentation',
  grant_report: 'Grant report',
  board_report: 'Board report',
  email: 'Email',
  print: 'Print',
  other: 'Other',
};

export const formatGroupWords: Readonly<Record<ExpressionFormat, string>> = {
  social_post: 'Social posts',
  newsletter_article: 'Newsletter articles',
  annual_report: 'Annual reports',
  web_page: 'Web pages',
  blog_post: 'Blog posts',
  video: 'Videos',
  audio: 'Audio',
  presentation: 'Presentations',
  grant_report: 'Grant reports',
  board_report: 'Board reports',
  email: 'Emails',
  print: 'Print',
  other: 'Other tellings',
};

export const expressionStatusWords: Readonly<Record<ExpressionStatus, string>> = {
  suggested: 'Suggested',
  confirmed: 'Confirmed',
  retired: 'Retired',
};

export const flagWords: Readonly<Record<ExpressionFlag, string>> = {
  told_above_level: 'Told above its level',
  told_without_consent: 'Told without consent',
};

export const precisionWords: Readonly<Record<LocationPrecision | 'unconsented', string>> = {
  region: 'Outside the platform: country and region only',
  country: 'Outside the platform: country only',
  none: 'Outside the platform: no location',
  unconsented: 'Outside the platform: not until consent is recorded',
};
