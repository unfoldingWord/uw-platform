import { sql, type SQL } from 'drizzle-orm';
import { levelsShownIn, type RenderChannel } from '@uw/contracts';
import { formatDate } from '@uw/core/dates';
import { pages } from '@uw/db/schema';

export const STORY_TYPE = 'impact_story';

function consentInEffectSql(day: string): SQL {
  return sql`c.withdrawn_at IS NULL AND c.consented_on <= ${day}::date
      AND (c.consent_expires IS NULL OR c.consent_expires > ${day}::date)`;
}

export function storyChannelFilter(channel: RenderChannel, at: Date): SQL | undefined {
  const shown = levelsShownIn(channel);
  if (shown.includes('internal')) return undefined;
  const levels = sql.join(
    shown.map((level) => sql`${level}`),
    sql`, `,
  );
  const today = formatDate(at);
  return sql`(${pages.type} <> ${STORY_TYPE} OR EXISTS (
    SELECT 1 FROM story_levels l JOIN story_consents c ON c.page_id = l.page_id
    WHERE l.page_id = ${pages.id} AND l.level IN (${levels}) AND ${consentInEffectSql(today)}))`;
}
