import type { Context } from 'hono';
import { raw } from 'hono/html';
import { formatInstant } from '@uw/core/dates';
import { Card } from '@uw/ui/components/card.tsx';
import { FavouriteToggle } from '@uw/ui/components/chip.tsx';
import { HumanActionLink } from '@uw/ui/components/human-action.tsx';
import { Note } from '@uw/ui/components/note.tsx';
import { PageHead } from '@uw/ui/components/page-head.tsx';
import { Table } from '@uw/ui/components/table.tsx';
import type { AppEnv } from '../../deps.ts';
import type { Heading, Rendered } from '../../markdown/render.ts';
import { draftsOf } from '../../pages/drafts.ts';
import { renderPage } from '../../pages/render-page.ts';
import type { PageVersion } from '../../pages/history.ts';
import { openComments } from '../../pages/comments.ts';
import { isFavourite } from '../../pages/favourites.ts';
import { recordView } from '../../pages/recent.ts';
import { verificationOf } from '../../pages/verification.ts';
import { renderScreen, screenKernel, screenRefusal, type ScreenKernel } from '../parts/frame.tsx';
import {
  backOf,
  pageLink,
  pageSpec,
  shownPage,
  typeWords,
  type ShownPage,
} from '../parts/page-shown.ts';
import { idParam } from '../parts/params.ts';
import { PageStatusBadge } from '../parts/page-status.tsx';
import {
  pageCommentsPath,
  pageEditPath,
  pageExportPath,
  pageManagePath,
  pagePath,
  pageVersionPath,
  wikiNewPath,
  withBack,
} from '../parts/paths.ts';
import { notFound } from './not-found.tsx';
import { commitOf } from '../../env.ts';

const MIN_CONTENTS = 2;
const tocLink =
  'block rounded-sm py-1 text-sm font-semibold text-text-2 outline-offset-2 outline-accent-text hover:text-accent-text focus-visible:outline-2';

function savedVersion(raw: string | undefined): number | null {
  const version = Number(raw);
  return raw !== undefined && Number.isInteger(version) && version >= 1 ? version : null;
}

function History(props: { readonly pageId: string; readonly versions: readonly PageVersion[] }) {
  const rows = props.versions.map((entry) => ({
    version: (
      <a href={pageVersionPath(props.pageId, entry.version)} class={pageLink}>
        {String(entry.version)}
      </a>
    ),
    when: formatInstant(entry.savedAt),
    who: entry.savedBy,
    title: entry.title,
  }));
  const columns = [
    { key: 'version', label: 'Version', numeric: true },
    { key: 'when', label: 'Saved' },
    { key: 'who', label: 'By' },
    { key: 'title', label: 'Title' },
  ];
  return (
    <Card title="History" sub="Newest first" flush>
      {rows.length === 0 ? (
        <p class="m-0 px-4 py-3 text-sm text-text-3">No saved versions yet.</p>
      ) : (
        <Table caption="Versions of this page" columns={columns} rows={rows} bare />
      )}
    </Card>
  );
}

function Contents(props: { readonly headings: readonly Heading[] }) {
  if (props.headings.length < MIN_CONTENTS) return null;
  return (
    <aside class="shrink-0 lg:sticky lg:top-5 lg:w-aside">
      <Card title="On this page">
        <nav aria-label="On this page">
          <ul class="m-0 flex list-none flex-col p-0">
            {props.headings.map((heading) => (
              <li class={heading.depth === 3 ? 'pl-4' : ''}>
                <a href={`#${heading.id}`} class={tocLink}>
                  {heading.text}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </Card>
    </aside>
  );
}

function PageList(props: {
  readonly title: string;
  readonly mark: 'children' | 'backlinks';
  readonly pages: ShownPage['children'];
}) {
  if (props.pages.length === 0) return null;
  const marked = { [`data-${props.mark}`]: '' };
  return (
    <Card title={props.title}>
      <ul class="m-0 flex list-none flex-col gap-1 p-0" {...marked}>
        {props.pages.map((child) => (
          <li>
            <a href={pagePath(child.id)} class={pageLink}>
              {child.title}
            </a>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Verified(props: { readonly shown: ShownPage; readonly at: Date }) {
  const { page } = props.shown;
  if (page.type !== 'knowledge') return null;
  const verification = verificationOf(page.frontmatter, props.at);
  if (verification.state === 'never') return null;
  if (verification.state === 'lapsed') {
    return (
      <Note>{`Verification lapsed on ${verification.until}. This page may be out of date.`}</Note>
    );
  }
  return <p class="m-0 text-sm text-text-3">{`Verified until ${verification.until}.`}</p>;
}

function Take(props: { readonly pageId: string; readonly open: number }) {
  const { open } = props;
  const comments =
    open === 0 ? 'Comments' : open === 1 ? '1 open comment' : `${String(open)} open comments`;
  return (
    <p class="m-0 flex flex-wrap items-center gap-4 text-sm">
      <a href={pageCommentsPath(props.pageId)} class={pageLink}>
        {comments}
      </a>
      <button
        type="button"
        data-comment-passage=""
        data-href={pageCommentsPath(props.pageId)}
        class={`${pageLink} cursor-pointer`}
      >
        Comment on the selected words
      </button>
      <a href={pageExportPath(props.pageId)} class={pageLink}>
        Export as markdown
      </a>
      <button type="button" data-print="" class={`${pageLink} cursor-pointer`}>
        Print or save as PDF
      </button>
    </p>
  );
}

function Manage(props: { readonly shown: ShownPage }) {
  const { page, canEdit } = props.shown;
  if (!canEdit || page.type !== 'knowledge') return null;
  return (
    <p class="m-0 flex flex-wrap items-center gap-4 text-sm">
      <a href={wikiNewPath({ parent: page.id })} class={pageLink}>
        New page under this one
      </a>
      <a href={pageManagePath(page.id)} class={pageLink}>
        Move, copy or retire
      </a>
    </p>
  );
}

type Extras = {
  readonly back: string | null;
  readonly saved: number | null;
  readonly rendered: Rendered;
  readonly drafted: boolean;
  readonly at: Date;
  readonly openComments: number;
  readonly favourite: boolean;
};

function Notices(props: { readonly shown: ShownPage; readonly extras: Extras }) {
  const { shown, extras } = props;
  const { back, saved } = extras;
  return (
    <>
      {back === null ? null : (
        <p class="m-0">
          <a href={back} class={pageLink}>
            Back to Stages & Controls
          </a>
        </p>
      )}
      {saved === null ? null : <Note>{`Saved as version ${String(saved)}.`}</Note>}
      {shown.page.status === 'retired' ? (
        <Note>This page is retired. It is hidden from lists and search.</Note>
      ) : null}
      <Verified shown={shown} at={extras.at} />
      <Manage shown={shown} />
      {extras.drafted ? (
        <Note>There is an unsaved draft of this page. You are reading it as last saved.</Note>
      ) : null}
    </>
  );
}

function body(shown: ShownPage, extras: Extras) {
  const { page } = shown;
  const { back, rendered } = extras;
  const pencil = shown.canEdit ? (
    <HumanActionLink
      href={withBack(pageEditPath(page.id), back)}
      label="Edit"
      name="Edit this page"
      icon="pen"
    />
  ) : undefined;
  return (
    <>
      <PageHead
        eyebrow={typeWords[page.type] ?? page.type}
        title={page.title}
        lede={`Version ${String(page.version)} in area ${page.jdArea}.`}
        actions={
          <>
            <PageStatusBadge status={page.status} />
            <FavouriteToggle pageId={page.id} on={extras.favourite} />
            {pencil}
          </>
        }
      />
      <div class="flex flex-col gap-5">
        <Notices shown={shown} extras={extras} />
        <div class="flex flex-col gap-5 lg:flex-row lg:items-start">
          <div class="min-w-0 flex-1">
            <Card>
              <div data-page-body="">{raw(rendered.html)}</div>
            </Card>
          </div>
          <Contents headings={rendered.headings} />
        </div>
        <PageList title="Pages under this one" mark="children" pages={shown.children} />
        <PageList title="Linked from" mark="backlinks" pages={shown.backlinks} />
        <Take pageId={page.id} open={extras.openComments} />
        <History pageId={page.id} versions={shown.versions} />
      </div>
    </>
  );
}

type Stored = Pick<Extras, 'rendered' | 'openComments' | 'favourite'>;

async function storedExtras(
  c: Context<AppEnv>,
  screen: ScreenKernel,
  shown: ShownPage,
): Promise<Stored> {
  const database = c.get('database');
  if (database === null) {
    return { rendered: { html: '', headings: [] }, openComments: 0, favourite: false };
  }
  const { actor } = screen.caller;
  const { page } = shown;
  await recordView(database.db, actor, page.id, screen.at);
  return {
    rendered: await renderPage(database.db, actor, page, screen.at, commitOf(c.env)),
    openComments: await openComments(database.db, page.id),
    favourite: await isFavourite(database.db, actor, page.id),
  };
}

export async function pageScreen(c: Context<AppEnv>): Promise<Response> {
  const screen = screenKernel(c);
  if (screen === null) return screenRefusal(c);
  const pageId = idParam(c.req.param('pageId'));
  if (pageId === null) return notFound(c);
  const read = await screen.kernel.views.page(screen.caller, { pageId }, { at: screen.at });
  const shown = read.status === 'accepted' ? await shownPage(c, screen, pageId) : null;
  if (shown === null) return notFound(c);
  const draft = shown.canEdit
    ? await draftsOf(c.env)?.status(shown.page.id, shown.page.version)
    : null;
  const extras = {
    ...(await storedExtras(c, screen, shown)),
    drafted: draft?.dirty === true,
    at: screen.at,
    back: backOf(c.req.query('back')),
    saved: savedVersion(c.req.query('saved')),
  };
  return renderScreen(c, pageSpec(shown, null), body(shown, extras));
}
