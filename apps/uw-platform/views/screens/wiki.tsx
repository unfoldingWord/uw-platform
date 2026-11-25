import type { Context } from 'hono';
import type { PageCategory, PageEntry } from '@uw/contracts';
import { can } from '@uw/core/acl';
import type { Principal } from '@uw/core/principal';
import { ButtonLink } from '@uw/ui/components/button.tsx';
import { Disclosure } from '@uw/ui/components/disclosure.tsx';
import { EmptyState } from '@uw/ui/components/empty-state.tsx';
import { HumanActionLink } from '@uw/ui/components/human-action.tsx';
import { LinkTree } from '@uw/ui/components/link-tree.tsx';
import { RailList, railLink } from '@uw/ui/components/rail-list.tsx';
import { Section } from '@uw/ui/components/section.tsx';
import { DocumentShape } from '@uw/ui/shapes/document.tsx';
import type { AppEnv } from '../../deps.ts';
import { categoryCounts, knowledgePages } from '../../pages/categories.ts';
import { favouritesOf } from '../../pages/favourites.ts';
import { lapsedCount } from '../../pages/verification.ts';
import { renderScreen, screenKernel, screenRefusal } from '../parts/frame.tsx';
import { areaLabel, moduleCodes, pageNames } from '../parts/names.ts';
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

type Reader = { readonly actor: Principal; readonly at: Date };

function CategorySummary(props: { readonly category: PageCategory }) {
  const { category } = props;
  const meta = countWords(category.pages);
  return (
    <>
      <span class="font-heavy">{category.name ?? category.code}</span>
      <span class="text-sm text-text-3">
        {category.name === null ? meta : `${category.code} · ${meta}`}
      </span>
    </>
  );
}

function NewHere(props: { readonly category: PageCategory; readonly reader: Reader }) {
  const { category, reader } = props;
  const area = { kind: 'area', area: category.area } as const;
  if (!can(reader.actor, 'write', area, reader.at)) return null;
  return (
    <ButtonLink
      href={wikiNewPath({ category: category.code })}
      variant="ghost"
      size="sm"
      icon="plus"
      label={`New page in ${category.name ?? category.code}`}
    >
      <span class="pointer-coarse:sr-only">New page here</span>
    </ButtonLink>
  );
}

function CategoryPages(props: {
  readonly category: PageCategory;
  readonly filed: Filed;
  readonly reader: Reader;
}) {
  const { category } = props;
  const entries = props.filed.get(category.code) ?? [];
  return (
    <Disclosure
      attrs={{ 'data-category': category.code }}
      summary={<CategorySummary category={category} />}
      actions={<NewHere category={category} reader={props.reader} />}
    >
      {entries.length === 0 ? (
        <p class="m-0 text-sm text-text-3">No page is filed here yet.</p>
      ) : (
        <LinkTree label={`Pages in ${category.code}`} nodes={pageLinks(entries)} />
      )}
    </Disclosure>
  );
}

function AreaSection(props: {
  readonly group: Group;
  readonly filed: Filed;
  readonly reader: Reader;
}) {
  const { group } = props;
  return (
    <Section title={group.name} sub={group.code} attrs={{ 'data-area': group.code }}>
      {group.categories.map((category) => (
        <CategoryPages category={category} filed={props.filed} reader={props.reader} />
      ))}
    </Section>
  );
}

type Rail = {
  readonly lapsed: number;
  readonly favourites: readonly { readonly id: string; readonly title: string }[];
  readonly areas: readonly string[];
};

function Lapsed(props: { readonly count: number }) {
  if (props.count === 0) return null;
  return (
    <RailList label="Needs review">
      <li>
        <a href={wikiReviewPath()} class={railLink}>
          {props.count === 1 ? '1 page needs review' : `${String(props.count)} pages need review`}
        </a>
      </li>
    </RailList>
  );
}

function Favourites(props: { readonly pages: Rail['favourites'] }) {
  if (props.pages.length === 0) return null;
  return (
    <RailList label="Your favourites" attrs={{ 'data-favourites': '' }}>
      {props.pages.map((entry) => (
        <li>
          <a href={pagePath(entry.id)} class={railLink}>
            {entry.title}
          </a>
        </li>
      ))}
    </RailList>
  );
}

function WikiRail(props: { readonly rail: Rail }) {
  const { rail } = props;
  return (
    <>
      <Lapsed count={rail.lapsed} />
      <Favourites pages={rail.favourites} />
      {rail.areas.length === 0 ? null : (
        <RailList label="Area pages">
          {rail.areas.map((area) => (
            <li>
              <a href={wikiAreaPath(area)} class={railLink}>
                {areaLabel(area)}
              </a>
            </li>
          ))}
        </RailList>
      )}
      <p class="m-0 text-sm text-text-3">
        Know the name? Press Ctrl or Cmd with O to jump to any page.
      </p>
    </>
  );
}

function areasOf(groups: readonly Group[]): readonly string[] {
  return [...new Set(groups.flatMap((group) => group.categories.map((entry) => entry.area)))];
}

function Contents(props: {
  readonly groups: readonly Group[];
  readonly filed: Filed;
  readonly reader: Reader;
}) {
  if (props.groups.length === 0) {
    return (
      <EmptyState
        title="Nothing here yet"
        text="No knowledge page has been filed in an area you can read."
      />
    );
  }
  return (
    <>
      {props.groups.map((group) => (
        <AreaSection group={group} filed={props.filed} reader={props.reader} />
      ))}
    </>
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
  const spec = {
    title: pageNames.wiki,
    current: wikiPath(),
    code: moduleCodes.pages,
    crumbs: [{ label: pageNames.wiki }],
    branch: branchOf(groups, { lapsed }),
  };
  const rail = { lapsed, favourites, areas: areasOf(groups) };
  return renderScreen(
    c,
    spec,
    <DocumentShape
      head={{
        title: pageNames.wiki,
        lede: 'Every page you can read, by area and category.',
        actions: (
          <HumanActionLink href={wikiNewPath()} label="New page" name="New page" icon="pen" />
        ),
      }}
      rail={<WikiRail rail={rail} />}
      railLabel="On this wiki"
    >
      <Contents groups={groups} filed={byCategory(entries)} reader={{ actor, at: screen.at }} />
    </DocumentShape>,
  );
}
