import { randomUUID } from 'node:crypto';
import type {
  ExpressionFields,
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
      occurred_on: '2026-03-14',
      place: 'The well by the market in Region One',
      programs: [],
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
      occurred_on: null,
      place: null,
      programs: [],
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
      occurred_on: '2025-12-01',
      place: 'Region Three',
      programs: [],
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
      occurred_on: null,
      place: null,
      programs: [],
    },
  };
}

export const inventedExpressions: readonly ExpressionFields[] = [
  {
    title: 'Twelve readers at the well',
    format: 'social_post',
    venue: 'Social media',
    channel: 'public',
    url: 'https://social.example.org/posts/region-one-well',
    language: 'qaa',
    publishedOn: '2026-10-01',
    excerpt: 'Twelve readers now meet at the well in Region One.',
  },
  {
    title: 'The well, in the annual report',
    format: 'annual_report',
    venue: 'Annual report 2026',
    channel: 'newsletter',
    url: 'https://docs.example.org/document/d/annual-report-2026/edit',
    language: null,
    publishedOn: '2026-11-02',
    excerpt: 'A reading group in Region One grew from three to twelve.',
  },
  {
    title: 'A reading group grows',
    format: 'newsletter_article',
    venue: 'Supporter newsletter',
    channel: 'newsletter',
    url: 'https://news.example.org/issues/41/a-reading-group-grows',
    language: null,
    publishedOn: null,
    excerpt: null,
  },
];

export function expressionAt(index: number): ExpressionFields {
  return inventedExpressions.at(index) ?? never();
}

export async function seedProgram(
  db: Database,
  jdArea: string,
  title = 'Reading groups programme',
): Promise<string> {
  const id = randomUUID();
  await seedPage(db, {
    id,
    type: 'program',
    status: 'active',
    jdArea,
    slug: `program-${id.slice(0, 8)}`,
    title,
    bodyMd: '',
    frontmatter: {},
    parentId: null,
  });
  return id;
}

export type SeededStory = { readonly id: string; readonly story: InventedStory };

export async function seedStory(
  db: Database,
  jdArea: string,
  story: InventedStory = inventedStories[0] ?? never(),
  parentId: string | null = null,
  status: 'active' | 'retired' = 'active',
): Promise<SeededStory> {
  const id = randomUUID();
  await seedPage(db, {
    id,
    type: 'impact_story',
    status,
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
