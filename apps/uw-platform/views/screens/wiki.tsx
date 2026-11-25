import type { Context } from 'hono';
import type { PageCategory, PageEntry } from '@uw/contracts';
import { ButtonLink } from '@uw/ui/components/button.tsx';
import { Disclosure } from '@uw/ui/components/disclosure.tsx';
import { EmptyState } from '@uw/ui/components/empty-state.tsx';
import { HumanActionLink } from '@uw/ui/components/human-action.tsx';
import { LinkTree } from '@uw/ui/components/link-tree.tsx';
import { ListRow, RowList } from '@uw/ui/components/list-row.tsx';
import { Section } from '@uw/ui/components/section.tsx';
import { ListShape } from '@uw/ui/shapes/list.tsx';
import type { AppEnv } from '../../deps.ts';
import { categoryCounts, knowledgePages } from '../../pages/categories.ts';
import { favouritesOf } from '../../pages/favourites.ts';
import { lapsedCount } from '../../pages/verification.ts';
import { renderScreen, screenKernel, screenRefusal } from '../parts/frame.tsx';
import { moduleCodes, pageNames } from '../parts/names.ts';
import { byCategory, pageLinks } from '../parts/page-links.ts';
import { branchOf, groupsOf, type Group } from '../parts/wiki-tree.ts';
import { pagePath, wikiAreaPath, wikiNewPath, wikiPath, wikiReviewPath } from '../parts/paths.ts';

export function countWords(pages: number): string {
  return pages === 1 ? '1 page' : `${String(pages)} pages`;
}

export function CategoryTitle(props: {
  readonly code: string;
  readonly name: string | null;
  readonly pages: number;
}) {
  return (
    <>
      <span class="font-mono text-sm text-accent-text">{props.code}</span>{' '}
      {props.name === null ? null : `${props.name} `}
      <span class="text-sm font-normal text-text-3">{countWords(props.pages)}</span>
    </>
  );
}

type Filed = ReadonlyMap<string, readonly PageEntry[]>;

function CategoryPages(props: { readonly category: PageCategory; readonly filed: Filed }) {
  const { category } = props;
  const entries = props.filed.get(category.code) ?? [];
  return (
    <Disclosure
      attrs={{ 'data-category': category.code }}
      summary={<CategoryTitle code={category.code} name={category.name} pages={category.pages} />}
    >
      {entries.length === 0 ? (
        <p class="m-0 text-sm text-text-3">No page is filed here yet.</p>
      ) : (
        <LinkTree label={`Pages in ${category.code}`} nodes={pageLinks(entries)} />
      )}
      <p class="m-0">
        <ButtonLink href={wikiPath(category.code)} variant="ghost" size="sm">
          {`Open category ${category.code}`}
        </ButtonLink>
      </p>
    </Disclosure>
  );
}

function AreaSection(props: { readonly group: Group; readonly filed: Filed }) {
  const { group } = props;
  const areas = [...new Set(group.categories.map((category) => category.area))];
  return (
    <Section
      title={`${group.code} ${group.name}`}
      attrs={{ 'data-area': group.code }}
      actions={areas.map((area) => (
        <ButtonLink href={wikiAreaPath(area)} variant="ghost" size="sm">
          {`Home of ${area}`}
        </ButtonLink>
      ))}
    >
      {group.categories.map((category) => (
        <CategoryPages category={category} filed={props.filed} />
      ))}
    </Section>
  );
}

function Favourites(props: {
  readonly pages: readonly { readonly id: string; readonly title: string }[];
}) {
  if (props.pages.length === 0) return null;
  return (
    <Section title="Your favourites" attrs={{ 'data-favourites': '' }}>
      <RowList label="Your favourites">
        {props.pages.map((entry) => (
          <ListRow href={pagePath(entry.id)} title={entry.title} />
        ))}
      </RowList>
    </Section>
  );
}

function Lapsed(props: { readonly count: number }) {
  if (props.count === 0) return null;
  return (
    <p class="m-0">
      <ButtonLink href={wikiReviewPath()} icon="clock">
        {props.count === 1 ? '1 page needs review' : `${String(props.count)} pages need review`}
      </ButtonLink>
    </p>
  );
}

export async function wikiScreen(c: Context<AppEnv>): Promise<Response> {
  const screen = screenKernel(c);
  const database = c.get('database');
  if (screen === null || database === null) return screenRefusal(c);
  const { actor } = screen.caller;
  const [categories, entries, lapsed, favourites] = await Promise.all([
    categoryCounts(database.db, actor, screen.at),
    knowledgePages(database.db, actor, screen.at),
    lapsedCount(database.db, actor, screen.at),
    favouritesOf(database.db, actor, screen.at),
  ]);
  const groups = groupsOf(categories);
  const filed = byCategory(entries);
  const spec = {
    title: pageNames.wiki,
    current: wikiPath(),
    code: moduleCodes.pages,
    crumbs: [{ label: pageNames.wiki }],
    branch: branchOf(groups, { lapsed }),
  };
  return renderScreen(
    c,
    spec,
    <ListShape
      head={{
        title: pageNames.wiki,
        lede: 'Every knowledge page you can read, by area and category. Close a category to hide its pages. Press Ctrl or Cmd with O to jump to a page by name.',
        actions: (
          <HumanActionLink href={wikiNewPath()} label="New page" name="New page" icon="pen" />
        ),
      }}
    >
      <Lapsed count={lapsed} />
      <Favourites pages={favourites} />
      {groups.length === 0 ? (
        <EmptyState
          title="Nothing here yet"
          text="No knowledge page has been filed in an area you can read."
        />
      ) : (
        groups.map((group) => <AreaSection group={group} filed={filed} />)
      )}
    </ListShape>,
  );
}
