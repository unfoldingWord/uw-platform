import type { Context } from 'hono';
import { EmptyState } from '@uw/ui/components/empty-state.tsx';
import { Table } from '@uw/ui/components/table.tsx';
import { ListShape } from '@uw/ui/shapes/list.tsx';
import type { AppEnv } from '../../deps.ts';
import { lapsedPages } from '../../pages/verification.ts';
import { renderScreen, screenKernel, screenRefusal } from '../parts/frame.tsx';
import { wikiBranch } from '../parts/wiki-tree.ts';
import { moduleCodes, pageNames } from '../parts/names.ts';
import { pagePath, wikiPath } from '../parts/paths.ts';
import { namesOf, shownIdentity, Who } from '../parts/person.tsx';

const spec = {
  title: pageNames.wikiReview,
  current: wikiPath(),
  code: moduleCodes.pages,
  crumbs: [{ label: pageNames.wiki, href: wikiPath() }, { label: pageNames.wikiReview }],
};

const rowLink =
  'font-semibold text-text no-underline outline-offset-2 outline-accent-text hover:text-accent-text focus-visible:outline-2';

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
  const names = await namesOf(
    database.db,
    lapsed.map((entry) => entry.ownerIdentity),
  );
  const reading = { reader: screen.caller.actor, at: screen.at };
  const rows = lapsed.map((entry) => ({
    page: (
      <a href={pagePath(entry.id)} class={rowLink}>
        {entry.title}
      </a>
    ),
    category: entry.category ?? '',
    owner: (
      <Who
        reading={reading}
        who={shownIdentity(entry.ownerIdentity, names, () => entry.owner ?? 'No owner')}
      />
    ),
    until: entry.until,
  }));
  const branch = await wikiBranch(database.db, screen.caller.actor, screen.at, {});
  return renderScreen(
    c,
    { ...spec, branch },
    <ListShape
      head={{
        eyebrow: pageNames.wiki,
        title: 'Needs review',
        lede: 'Pages whose verification has lapsed, oldest first. Read the page, correct it, then verify it again from its manage screen.',
      }}
    >
      {rows.length === 0 ? (
        <EmptyState
          title="Nothing needs review"
          text="No page you can read has a lapsed verification."
        />
      ) : (
        <Table caption="Pages needing review" columns={columns} rows={rows} />
      )}
    </ListShape>,
  );
}
