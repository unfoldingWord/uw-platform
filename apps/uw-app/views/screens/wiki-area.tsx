import type { Context } from 'hono';
import { raw } from 'hono/html';
import { jdAreaSchema, type Page } from '@uw/contracts';
import type { Principal } from '@uw/core/principal';
import type { Database } from '@uw/db/client';
import { can } from '@uw/core/acl';
import { Card } from '@uw/ui/components/card.tsx';
import { Note } from '@uw/ui/components/note.tsx';
import { PageHead } from '@uw/ui/components/page-head.tsx';
import type { AppEnv } from '../../deps.ts';
import { areaHome, type AreaHome } from '../../pages/area-homes.ts';
import { commitOf } from '../../env.ts';
import { renderPage } from '../../pages/render-page.ts';
import { readPage } from '../../pages/store.ts';
import { renderScreen, screenKernel, screenRefusal } from '../parts/frame.tsx';
import { areaLabel, moduleCodes, pageNames } from '../parts/names.ts';
import { pageLink } from '../parts/page-shown.ts';
import { pageManagePath, pagePath, wikiPath } from '../parts/paths.ts';
import { notFound } from './not-found.tsx';
import { countWords } from './wiki.tsx';

const row =
  'flex items-baseline gap-3 rounded-sm px-2 py-1 text-sm text-text outline-offset-2 outline-accent-text hover:bg-hover focus-visible:outline-2';

function Categories(props: { readonly home: AreaHome }) {
  const { categories } = props.home;
  return (
    <aside class="shrink-0 lg:w-aside">
      <Card title="Categories">
        {categories.length === 0 ? (
          <p class="m-0 text-sm text-text-2">No page is filed in this area yet.</p>
        ) : (
          <ul data-area-categories="" class="m-0 flex list-none flex-col gap-1 p-0">
            {categories.map((entry) => (
              <li>
                <a href={wikiPath(entry.code)} class={row}>
                  <span class="font-mono text-sm font-semibold text-accent-text">{entry.code}</span>
                  {entry.name === null ? null : <span class="font-heavy">{entry.name}</span>}
                  <span class="ml-auto text-xs text-text-3">{countWords(entry.pages)}</span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </aside>
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
    <>
      <Card title={shown.page.title}>
        <div data-page-body="">{raw(shown.html)}</div>
      </Card>
      <p class="m-0 flex flex-wrap gap-4 text-sm">
        <a href={pagePath(shown.page.id)} class={pageLink}>
          Open the home page
        </a>
        {admin ? (
          <a href={pageManagePath(shown.page.id)} class={pageLink}>
            Change the home page
          </a>
        ) : null}
      </p>
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
    current: wikiPath(),
    code: moduleCodes.pages,
    crumbs: [{ label: pageNames.wiki, href: wikiPath() }, { label: title }],
  };
  return renderScreen(
    c,
    spec,
    <>
      <PageHead eyebrow={pageNames.wiki} title={title} />
      <div class="flex flex-col gap-5 lg:flex-row lg:items-start">
        <div class="flex min-w-0 flex-1 flex-col gap-3">
          <HomePage shown={shown} admin={admin} />
        </div>
        <Categories home={home} />
      </div>
    </>,
  );
}
