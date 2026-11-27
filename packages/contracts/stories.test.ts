import { describe, expect, it } from 'vitest';
import {
  impactStoryFrontmatterSchema,
  levelsShownIn,
  raisesLevel,
  recordStoryConsentCommandSchema,
  renderChannels,
  sensitivityLevels,
  storyMayAppear,
  type RenderChannel,
  type SensitivityLevel,
} from './stories.ts';

const shown: Readonly<Record<RenderChannel, readonly SensitivityLevel[]>> = {
  platform: ['internal', 'private_circulation', 'newsletter', 'public'],
  private_circulation: ['private_circulation', 'newsletter', 'public'],
  newsletter: ['newsletter', 'public'],
  public: ['public'],
};

describe('#201 the sensitivity ladder decides where a story may appear', () => {
  it.each(renderChannels)(
    '#201 shows in the %s channel only the levels at or above it',
    (channel) => {
      for (const level of sensitivityLevels) {
        expect(storyMayAppear(level, channel)).toBe(shown[channel].includes(level));
      }
      expect(levelsShownIn(channel)).toEqual(shown[channel]);
    },
  );

  it('#201 refuses a newsletter story to the public channel and shows it in a newsletter', () => {
    expect(storyMayAppear('newsletter', 'public')).toBe(false);
    expect(storyMayAppear('newsletter', 'newsletter')).toBe(true);
    expect(storyMayAppear('internal', 'platform')).toBe(true);
  });

  it('#201 counts only a move up the ladder as raising', () => {
    expect(raisesLevel('internal', 'newsletter')).toBe(true);
    expect(raisesLevel('public', 'newsletter')).toBe(false);
    expect(raisesLevel('newsletter', 'newsletter')).toBe(false);
  });
});

describe('#201 an impact story tags its place and language as codes', () => {
  const filed = { jd_category: '41' };

  it('#201 defaults every tag and takes a user-assigned country, its region and a local-use language', () => {
    expect(impactStoryFrontmatterSchema.parse(filed)).toEqual({
      ...filed,
      country: null,
      region: null,
      languages: [],
      illustrates: [],
      themes: [],
      occurred_on: null,
      place: null,
      programs: [],
    });
    const tagged = { ...filed, country: 'XA', region: 'XA-01', languages: ['qaa', 'en-GB'] };
    expect(impactStoryFrontmatterSchema.safeParse(tagged).success).toBe(true);
  });

  it('#201 refuses a country that is not a code, a region outside its country and a malformed language', () => {
    const refused = [
      { ...filed, country: 'Atlantis' },
      { ...filed, country: 'xa' },
      { ...filed, country: 'XA', region: 'XB-01' },
      { ...filed, region: 'XA-01' },
      { ...filed, languages: ['en_GB'] },
      { ...filed, languages: ['qaa', 'qaa'] },
      { ...filed, illustrates: ['not-a-page'] },
      { ...filed, level: 'public' },
    ];
    for (const value of refused) {
      expect(impactStoryFrontmatterSchema.safeParse(value).success).toBe(false);
    }
  });
});

describe('#201 a consent record names its release and its day', () => {
  const recorded = {
    command: 'record_story_consent',
    requestId: '00000000-0000-4000-8000-000000002011',
    pageId: '00000000-0000-4000-8000-000000002012',
    consentReference: 'https://files.example.org/releases/ada-example.pdf',
    consentedBy: 'Ada Example',
    consentForm: 'written',
    consentedOn: '2026-11-01',
    consentExpires: null,
    anonymised: false,
    nameUse: 'pseudonym',
    locationPrecision: 'region',
    photoRelease: false,
    photoReference: null,
    reviewOn: '2027-11-01',
  };

  it('#201 takes a full record and refuses one without a reference or a day', () => {
    expect(recordStoryConsentCommandSchema.safeParse(recorded).success).toBe(true);
    expect(
      recordStoryConsentCommandSchema.safeParse({ ...recorded, consentReference: ' ' }).success,
    ).toBe(false);
    expect(
      recordStoryConsentCommandSchema.safeParse({ ...recorded, consentedOn: '01/11/2026' }).success,
    ).toBe(false);
  });
});
