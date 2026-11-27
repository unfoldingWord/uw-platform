import { randomUUID } from 'node:crypto';
import type {
  ImpactStoryFrontmatter,
  Principal,
  RecordStoryConsentCommand,
  SensitivityLevel,
} from '@uw/contracts';
import type { Database } from '@uw/db/client';
import { seedPage } from '@uw/db/test-seed';
import { recordStoryConsent, setStoryLevel } from '../stories/levels.ts';

export type InventedStory = {
  readonly title: string;
  readonly subject: string;
  readonly bodyMd: string;
  readonly frontmatter: ImpactStoryFrontmatter;
};

export const inventedStories: readonly InventedStory[] = [
  {
    title: 'The well in Region One',
    subject: 'Ada Example',
    bodyMd:
      'Ada Example read the first chapter aloud in Region One, and the reading group grew to twelve.',
    frontmatter: {
      jd_category: '41',
      country: 'XA',
      region: 'XA-01',
      languages: ['qaa'],
      illustrates: [],
      themes: ['reading groups'],
    },
  },
  {
    title: 'A checker in Region Two',
    subject: 'Bo Example',
    bodyMd: 'Bo Example checked the draft with three neighbours in Region Two before the review.',
    frontmatter: {
      jd_category: '41',
      country: 'XB',
      region: 'XB-02',
      languages: ['qab'],
      illustrates: [],
      themes: ['checking'],
    },
  },
  {
    title: 'Songs from Region Three',
    subject: 'Cy Example',
    bodyMd: 'Cy Example set two psalms to local tunes in Region Three.',
    frontmatter: {
      jd_category: '41',
      country: 'XC',
      region: null,
      languages: ['qac'],
      illustrates: [],
      themes: [],
    },
  },
];

export function photoStory(photoId: string): InventedStory {
  return {
    title: 'A photograph from Region Four',
    subject: 'Di Example',
    bodyMd: `Di Example at the reading.\n\n![The reading](/api/files/${photoId})`,
    frontmatter: {
      jd_category: '41',
      country: 'XD',
      region: null,
      languages: [],
      illustrates: [],
      themes: [],
    },
  };
}

export type SeededStory = { readonly id: string; readonly story: InventedStory };

export async function seedStory(
  db: Database,
  jdArea: string,
  story: InventedStory = inventedStories[0] ?? never(),
  parentId: string | null = null,
): Promise<SeededStory> {
  const id = randomUUID();
  await seedPage(db, {
    id,
    type: 'impact_story',
    status: 'active',
    jdArea,
    slug: `story-${id.slice(0, 8)}`,
    title: story.title,
    bodyMd: story.bodyMd,
    frontmatter: story.frontmatter,
    parentId,
  });
  return { id, story };
}

function never(): never {
  throw new Error('no invented story');
}

export function consentFor(
  pageId: string,
  overrides: Partial<RecordStoryConsentCommand> = {},
): RecordStoryConsentCommand {
  return {
    command: 'record_story_consent',
    requestId: randomUUID(),
    pageId,
    consentReference: 'https://files.example.org/releases/release-001.pdf',
    consentedBy: 'Ada Example',
    consentForm: 'written',
    consentedOn: '2026-11-01',
    consentExpires: null,
    anonymised: false,
    nameUse: 'pseudonym',
    locationPrecision: 'region',
    photoRelease: true,
    photoReference: 'https://files.example.org/releases/photo-001.pdf',
    reviewOn: '2027-11-01',
    ...overrides,
  };
}

export async function levelled(
  db: Database,
  admin: Principal,
  pageId: string,
  level: SensitivityLevel,
): Promise<void> {
  const at = new Date();
  const consented = await recordStoryConsent(db, admin, consentFor(pageId), at);
  if (!consented.ok) throw new Error(`consent refused: ${consented.reason}`);
  const command = { command: 'set_story_level', requestId: randomUUID(), pageId, level } as const;
  const raised = await setStoryLevel(db, admin, command, at);
  if (!raised.ok) throw new Error(`raise refused: ${raised.reason}`);
}
