import type { Context } from 'hono';
import { raw } from 'hono/html';
import { jdAreaSchema, type Page } from '@uw/contracts';
import type { Principal } from '@uw/core/principal';
import type { Database } from '@uw/db/client';
import { can } from '@uw/core/acl';
import { ButtonLink } from '@uw/ui/components/button.tsx';
import { EmptyState } from '@uw/ui/components/empty-state.tsx';
import { ListRow, RowList } from '@uw/ui/components/list-row.tsx';
import { Note } from '@uw/ui/components/note.tsx';
import { Section } from '@uw/ui/components/section.tsx';
import { ListShape } from '@uw/ui/shapes/list.tsx';
import type { AppEnv } from '../../deps.ts';
import { areaHome, type AreaHome } from '../../pages/area-homes.ts';
import { commitOf } from '../../env.ts';
import { renderPage } from '../../pages/render-page.ts';
import { readPage } from '../../pages/store.ts';
import { renderScreen, screenKernel, screenRefusal } from '../parts/frame.tsx';
import { wikiBranch } from '../parts/wiki-tree.ts';
import { areaLabel, moduleCodes, pageNames } from '../parts/names.ts';
import { pageManagePath, pagePath, wikiAreaPath, wikiPath } from '../parts/paths.ts';
import { notFound } from './not-found.tsx';
import { CategoryTitle } from './wiki.tsx';

function Categories(props: { readonly home: AreaHome }) {
  const { categories } = props.home;
  return (
    <Section title="Categories" attrs={{ 'data-area-categories': '' }}>
      {categories.length === 0 ? (
        <EmptyState title="No categories yet" text="No page is filed in this area yet." />
      ) : (
        <RowList label="Categories">
          {categories.map((entry) => (
            <ListRow
              href={wikiPath(entry.code)}
              title={<CategoryTitle code={entry.code} name={entry.name} pages={entry.pages} />}
            />
          ))}
        </RowList>
      )}
    </Section>
  );
}

type Shown = { readonly page: Page; readonly html: string } | null;

function HomePage(props: { readonly shown: Shown; readonly admin: boolean }) {
  const { shown, admin } = props;
  if (shown === null) {
    return (
      <Note>
        {admin
          ? 'This area has no home page yet. Open a page in it, choose Move, copy or retire, and make it the home page.'
          : 'This area has no home page yet.'}
      </Note>
    );
  }
  return (
    <Section title={shown.page.title}>
      <div data-page-body="">{raw(shown.html)}</div>
    </Section>
  );
}

function HomeActions(props: { readonly shown: Page; readonly admin: boolean }) {
  const { shown } = props;
  return (
    <>
      <ButtonLink href={pagePath(shown.id)}>Open the home page</ButtonLink>
      {props.admin ? (
        <ButtonLink href={pageManagePath(shown.id)} variant="ghost">
          Change the home page
        </ButtonLink>
      ) : null}
    </>
  );
}

type Reading = {
  readonly db: Database;
  readonly actor: Principal;
  readonly at: Date;
  readonly revision: string;
};

async function shownHome(reading: Reading, home: AreaHome): Promise<Shown> {
  const { db, actor, at } = reading;
  const page = home.home === null ? null : await readPage(db, actor, home.home.id, at);
  if (page === null) return null;
  return { page, html: (await renderPage(db, actor, page, at, reading.revision)).html };
}

export async function wikiAreaScreen(c: Context<AppEnv>): Promise<Response> {
  const screen = screenKernel(c);
  const database = c.get('database');
  if (screen === null || database === null) return screenRefusal(c);
  const area = jdAreaSchema.safeParse(c.req.param('area'));
  const { actor } = screen.caller;
  const home = area.success ? await areaHome(database.db, actor, area.data, screen.at) : null;
  if (home === null) return notFound(c);
  const reading = { db: database.db, actor, at: screen.at, revision: commitOf(c.env) };
  const shown = await shownHome(reading, home);
  const admin = can(actor, 'admin', { kind: 'area', area: home.area }, screen.at);
  const title = areaLabel(home.area);
  const spec = {
    title,
    current: wikiAreaPath(home.area),
    code: moduleCodes.pages,
    crumbs: [{ label: pageNames.wiki, href: wikiPath() }, { label: title }],
    branch: await wikiBranch(database.db, actor, screen.at, { area: home.area }),
  };
  return renderScreen(
    c,
    spec,
    <ListShape
      head={{
        eyebrow: pageNames.wiki,
        title,
        actions: shown === null ? undefined : <HomeActions shown={shown.page} admin={admin} />,
      }}
    >
      <HomePage shown={shown} admin={admin} />
      <Categories home={home} />
    </ListShape>,
  );
}
