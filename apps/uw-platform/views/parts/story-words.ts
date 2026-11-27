import type { RenderChannel, SensitivityLevel, StoryUseKind } from '@uw/contracts';
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
