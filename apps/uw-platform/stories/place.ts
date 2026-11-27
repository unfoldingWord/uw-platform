import {
  impactStoryFrontmatterSchema,
  type ImpactStoryFrontmatter,
  type LocationPrecision,
  type Page,
  type RenderChannel,
} from '@uw/contracts';
import type { Executor } from '@uw/db/client';
import { STORY_TYPE } from './channel-filter.ts';
import { consentRowOf } from './consent.ts';

type Where = Pick<ImpactStoryFrontmatter, 'country' | 'region' | 'place'>;

const nowhere: Where = { country: null, region: null, place: null };

export function locationAt(where: Where, precision: LocationPrecision | null): Where {
  if (precision === 'region') return { country: where.country, region: where.region, place: null };
  if (precision === 'country') return { country: where.country, region: null, place: null };
  return nowhere;
}

function precisionOf(value: string | undefined): LocationPrecision | null {
  return value === 'region' || value === 'country' || value === 'none' ? value : null;
}

export async function precisionOfStory(
  db: Executor,
  pageId: string,
): Promise<LocationPrecision | null> {
  const row = await consentRowOf(db, pageId);
  return row === null || row.withdrawnAt !== null ? null : precisionOf(row.locationPrecision);
}

export async function pageAtChannel(
  db: Executor,
  page: Page,
  channel: RenderChannel,
): Promise<Page> {
  if (channel === 'platform' || page.type !== STORY_TYPE) return page;
  const record = impactStoryFrontmatterSchema.safeParse(page.frontmatter);
  if (!record.success) return page;
  const where = locationAt(record.data, await precisionOfStory(db, page.id));
  return { ...page, frontmatter: { ...page.frontmatter, ...where } };
}
