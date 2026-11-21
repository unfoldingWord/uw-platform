import type { Context } from 'hono';
import type { PageCategory } from '@uw/contracts';
import { Card } from '@uw/ui/components/card.tsx';
import { HumanActionLink } from '@uw/ui/components/human-action.tsx';
import { PageHead } from '@uw/ui/components/page-head.tsx';
import type { AppEnv } from '../../deps.ts';
import { categoryCounts } from '../../pages/categories.ts';
import { favouritesOf } from '../../pages/favourites.ts';
import { lapsedPages } from '../../pages/verification.ts';
import { renderScreen, screenKernel, screenRefusal } from '../parts/frame.tsx';
import { moduleCodes, pageNames } from '../parts/names.ts';
import { branchOf, groupsOf, type Group } from '../parts/wiki-tree.ts';
import { pageLink } from '../parts/page-shown.ts';
import { pagePath, wikiAreaPath, wikiNewPath, wikiPath, wikiReviewPath } from '../parts/paths.ts';

const row =
  'flex items-baseline gap-3 rounded-sm px-4 py-2 text-base text-text outline-offset-2 outline-accent-text hover:bg-hover focus-visible:outline-2';

export function countWords(pages: number): string {
  return pages === 1 ? '1 page' : `${String(pages)} pages`;
}

function CategoryRow(props: { readonly category: PageCategory }) {
  const { category } = props;
  return (
    <li>
      <a href={wikiPath(category.code)} data-category={category.code} class={row}>
        <span class="font-mono text-sm font-semibold text-accent-text">{category.code}</span>{' '}
        {category.name === null ? null : <span class="font-heavy">{category.name} </span>}
        <span class="ml-auto text-sm text-text-3">{countWords(category.pages)}</span>
      </a>
    </li>
  );
}

function AreaCard(props: { readonly group: Group }) {
  const { group } = props;
  return (
    <section
      data-area={group.code}
      class="flex min-w-0 flex-col rounded-md border border-line bg-surface text-text"
    >
      <h2 class="m-0 border-b border-line px-4 py-3 text-md font-heavy text-text">
        <span class="font-mono text-sm font-semibold text-accent-text">{group.code}</span>{' '}
        {group.name}
      </h2>
      <ul class="m-0 flex list-none flex-col p-0 py-1">
        {group.categories.map((category) => (
          <CategoryRow category={category} />
        ))}
      </ul>
      <p class="m-0 flex flex-wrap gap-4 border-t border-line px-4 py-2 text-sm">
        {[...new Set(group.categories.map((category) => category.area))].map((area) => (
          <a href={wikiAreaPath(area)} class={pageLink}>
            {`Home of ${area}`}
          </a>
        ))}
      </p>
    </section>
  );
}

function Favourites(props: {
  readonly pages: readonly { readonly id: string; readonly title: string }[];
}) {
  if (props.pages.length === 0) return null;
  return (
    <Card title="Your favourites">
      <ul data-favourites="" class="m-0 flex list-none flex-col gap-1 p-0">
        {props.pages.map((entry) => (
          <li>
            <a href={pagePath(entry.id)} class={pageLink}>
              {entry.title}
            </a>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export async function wikiScreen(c: Context<AppEnv>): Promise<Response> {
  const screen = screenKernel(c);
  const database = c.get('database');
  if (screen === null || database === null) return screenRefusal(c);
  const groups = groupsOf(await categoryCounts(database.db, screen.caller.actor, screen.at));
  const lapsed = (await lapsedPages(database.db, screen.caller.actor, screen.at)).length;
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
    <>
      <PageHead
        title={pageNames.wiki}
        lede="The knowledge pages you can read, by area and category. Press Ctrl or Cmd with O to jump to a page by name."
        actions={
          <HumanActionLink href={wikiNewPath()} label="New page" name="New page" icon="pen" />
        }
      />
      <div class="flex flex-col gap-5">
        {lapsed === 0 ? null : (
          <p class="m-0">
            <a href={wikiReviewPath()} class={pageLink}>
              {lapsed === 1 ? '1 page needs review' : `${String(lapsed)} pages need review`}
            </a>
          </p>
        )}
        <Favourites pages={favourites} />
        {groups.length === 0 ? (
          <Card title="Nothing here yet">
            <p class="m-0 text-sm text-text-2">
              No knowledge page has been filed in an area you can read.
            </p>
          </Card>
        ) : (
          groups.map((group) => <AreaCard group={group} />)
        )}
      </div>
    </>,
  );
}
