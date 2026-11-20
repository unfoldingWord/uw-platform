import type { Context } from 'hono';
import { Card } from '@uw/ui/components/card.tsx';
import { PageHead } from '@uw/ui/components/page-head.tsx';
import { Table } from '@uw/ui/components/table.tsx';
import type { AppEnv } from '../../deps.ts';
import { lapsedPages } from '../../pages/verification.ts';
import { renderScreen, screenKernel, screenRefusal } from '../parts/frame.tsx';
import { moduleCodes, pageNames } from '../parts/names.ts';
import { pageLink } from '../parts/page-shown.ts';
import { pagePath, wikiPath } from '../parts/paths.ts';

const spec = {
  title: pageNames.wikiReview,
  current: wikiPath(),
  code: moduleCodes.pages,
  crumbs: [{ label: pageNames.wiki, href: wikiPath() }, { label: pageNames.wikiReview }],
};

const columns = [
  { key: 'page', label: 'Page' },
  { key: 'category', label: 'Category' },
  { key: 'owner', label: 'Owner' },
  { key: 'until', label: 'Lapsed on' },
];

export async function wikiReviewScreen(c: Context<AppEnv>): Promise<Response> {
  const screen = screenKernel(c);
  const database = c.get('database');
  if (screen === null || database === null) return screenRefusal(c);
  const lapsed = await lapsedPages(database.db, screen.caller.actor, screen.at);
  const rows = lapsed.map((entry) => ({
    page: (
      <a href={pagePath(entry.id)} class={pageLink}>
        {entry.title}
      </a>
    ),
    category: entry.category ?? '',
    owner: entry.owner ?? 'No owner',
    until: entry.until,
  }));
  return renderScreen(
    c,
    spec,
    <>
      <PageHead
        eyebrow={pageNames.wiki}
        title="Needs review"
        lede="Pages whose verification has lapsed, oldest first. Read the page, correct it, then verify it again from its manage screen."
      />
      <Card title="Lapsed" flush>
        {rows.length === 0 ? (
          <p class="m-0 px-4 py-3 text-sm text-text-2">
            No page you can read has a lapsed verification.
          </p>
        ) : (
          <Table caption="Pages needing review" columns={columns} rows={rows} bare />
        )}
      </Card>
    </>,
  );
}
