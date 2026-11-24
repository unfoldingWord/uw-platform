import type { Context } from 'hono';
import type { PageCategory } from '@uw/contracts';
import { ButtonLink } from '@uw/ui/components/button.tsx';
import { EmptyState } from '@uw/ui/components/empty-state.tsx';
import { HumanActionLink } from '@uw/ui/components/human-action.tsx';
import { ListRow, RowList } from '@uw/ui/components/list-row.tsx';
import { Section } from '@uw/ui/components/section.tsx';
import { ListShape } from '@uw/ui/shapes/list.tsx';
import type { AppEnv } from '../../deps.ts';
import { categoryCounts } from '../../pages/categories.ts';
import { favouritesOf } from '../../pages/favourites.ts';
import { lapsedCount } from '../../pages/verification.ts';
import { renderScreen, screenKernel, screenRefusal } from '../parts/frame.tsx';
import { moduleCodes, pageNames } from '../parts/names.ts';
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

function AreaSection(props: { readonly group: Group }) {
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
      <RowList label={`Categories in ${group.code}`}>
        {group.categories.map((category: PageCategory) => (
          <ListRow
            href={wikiPath(category.code)}
            attrs={{ 'data-category': category.code }}
            title={
              <CategoryTitle code={category.code} name={category.name} pages={category.pages} />
            }
          />
        ))}
      </RowList>
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
  const groups = groupsOf(await categoryCounts(database.db, screen.caller.actor, screen.at));
  const lapsed = await lapsedCount(database.db, screen.caller.actor, screen.at);
  const favourites = await favouritesOf(database.db, screen.caller.actor, screen.at);
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
        lede: 'The knowledge pages you can read, by area and category. Press Ctrl or Cmd with O to jump to a page by name.',
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
        groups.map((group) => <AreaSection group={group} />)
      )}
    </ListShape>,
  );
}
