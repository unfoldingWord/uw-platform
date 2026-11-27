import { and, asc, eq, ne } from 'drizzle-orm';
import {
  impactStoryFrontmatterSchema,
  sensitivityLevelSchema,
  type ImpactStoryFrontmatter,
  type LocationPrecision,
  type SensitivityLevel,
  type StoryExpression,
  type StorySummary,
  type StoryUse,
} from '@uw/contracts';
import { can } from '@uw/core/acl';
import type { Principal } from '@uw/core/principal';
import type { Executor } from '@uw/db/client';
import { pages, storyConsents, storyLevels } from '@uw/db/schema';
import { areaFilter } from '../pages/reads.ts';
import { STORY_TYPE } from './channel-filter.ts';
import { consentRowOf, consentStateOf, type ConsentRow, type ConsentState } from './consent.ts';
import { mediaOfStory, type StoryMedia } from './media.ts';
import { precisionOfStory } from './place.ts';
import { levelOf, storyPageOf, type StoryPage } from './story-pages.ts';
import { expressionsOfStory, programsShown, storySummaries } from './story-records.ts';
import { storyUsesOf } from './uses.ts';

export type ConsentShown =
  | { readonly kind: 'withheld' }
  | { readonly kind: 'none' }
  | (Omit<ConsentRow, 'pageId' | 'updatedBy'> & { readonly kind: ConsentState });

export type StoryState = {
  readonly story: StoryPage;
  readonly level: SensitivityLevel;
  readonly consent: ConsentShown;
  readonly uses: readonly StoryUse[];
  readonly media: readonly StoryMedia[];
  readonly admin: boolean;
  readonly writer: boolean;
  readonly record: ImpactStoryFrontmatter | null;
  readonly programs: readonly Program[];
  readonly expressions: readonly StoryExpression[];
};

type Program = { readonly id: string; readonly title: string };

export type StoryLine = {
  readonly id: string;
  readonly title: string;
  readonly jdArea: string;
  readonly status: string;
  readonly level: SensitivityLevel;
  readonly consent: ConsentShown['kind'];
  readonly reviewOn: string | null;
  readonly summary: StorySummary | null;
  readonly precision: LocationPrecision | null;
  readonly programs: readonly Program[];
};

function readsConsent(actor: Principal, area: string, at: Date): boolean {
  return can(actor, 'read', { kind: 'row', table: 'story_consents', area, ownerId: null }, at);
}

function shownConsent(row: ConsentRow | null, at: Date): ConsentShown {
  if (row === null) return { kind: 'none' };
  return {
    kind: consentStateOf(row, at),
    consentReference: row.consentReference,
    consentedBy: row.consentedBy,
    consentForm: row.consentForm,
    consentedOn: row.consentedOn,
    consentExpires: row.consentExpires,
    anonymised: row.anonymised,
    nameUse: row.nameUse,
    locationPrecision: row.locationPrecision,
    photoRelease: row.photoRelease,
    photoReference: row.photoReference,
    reviewOn: row.reviewOn,
    withdrawnAt: row.withdrawnAt,
    updatedAt: row.updatedAt,
  };
}

export async function storyStateFor(
  db: Executor,
  actor: Principal,
  pageId: string,
  at: Date,
): Promise<StoryState | null> {
  const story = await storyPageOf(db, pageId);
  if (story === null) return null;
  const area = { kind: 'area', area: story.jdArea } as const;
  if (!can(actor, 'read', area, at)) return null;
  const consent = readsConsent(actor, story.jdArea, at)
    ? shownConsent(await consentRowOf(db, story.id), at)
    : ({ kind: 'withheld' } as const);
  const record = await recordOf(db, story.id);
  return {
    record,
    programs: await programsShown(db, actor, record?.programs ?? [], at),
    expressions: await expressionsOfStory(db, story.id),
    story,
    level: await levelOf(db, story.id),
    consent,
    uses: await storyUsesOf(db, story.id),
    media: await mediaOfStory(db, story.id),
    admin: actor.kind === 'person' && can(actor, 'admin', area, at),
    writer: can(actor, 'write', area, at),
  };
}

async function recordOf(db: Executor, pageId: string): Promise<ImpactStoryFrontmatter | null> {
  const [row] = await db
    .select({ frontmatter: pages.frontmatter })
    .from(pages)
    .where(eq(pages.id, pageId));
  const parsed = impactStoryFrontmatterSchema.safeParse(row?.frontmatter);
  return parsed.success ? parsed.data : null;
}

const allStories = {
  query: null,
  program: null,
  country: null,
  formatPresent: null,
  formatAbsent: null,
  limit: 1000,
} as const;

async function linesTold(
  db: Executor,
  actor: Principal,
  lines: readonly Omit<StoryLine, 'summary' | 'precision' | 'programs'>[],
  at: Date,
): Promise<readonly StoryLine[]> {
  const summaries = new Map(
    (await storySummaries(db, actor, allStories, at)).map((each) => [each.id, each]),
  );
  const told: StoryLine[] = [];
  for (const line of lines) {
    const summary = summaries.get(line.id) ?? null;
    const programs = await programsShown(db, actor, summary?.programs ?? [], at);
    const precision = await precisionOfStory(db, line.id);
    told.push({ ...line, summary, precision, programs });
  }
  return told;
}

export async function storyBankLines(
  db: Executor,
  actor: Principal,
  at: Date,
): Promise<readonly StoryLine[]> {
  const areas = areaFilter(actor, at);
  if (areas === null) return [];
  const rows = await db
    .select({
      id: pages.id,
      title: pages.title,
      jdArea: pages.jdArea,
      status: pages.status,
      level: storyLevels.level,
      consent: storyConsents,
    })
    .from(pages)
    .leftJoin(storyLevels, eq(storyLevels.pageId, pages.id))
    .leftJoin(storyConsents, eq(storyConsents.pageId, pages.id))
    .where(and(eq(pages.type, STORY_TYPE), ne(pages.status, 'retired'), areas))
    .orderBy(asc(pages.title), asc(pages.id));
  const lines = rows.map(({ consent, level, ...row }) => {
    const shown = readsConsent(actor, row.jdArea, at)
      ? shownConsent(consent, at)
      : ({ kind: 'withheld' } as const);
    return {
      ...row,
      level: level === null ? 'internal' : sensitivityLevelSchema.parse(level),
      consent: shown.kind,
      reviewOn: 'reviewOn' in shown ? shown.reviewOn : null,
    };
  });
  return linesTold(db, actor, lines, at);
}
