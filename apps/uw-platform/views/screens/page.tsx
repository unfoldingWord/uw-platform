import type { Context } from 'hono';
import type { Child } from 'hono/jsx';
import type { Crumb } from '@uw/ui/components/top-bar.tsx';
import { raw } from 'hono/html';
import { formatInstant } from '@uw/core/dates';
import { knowledgeFrontmatterSchema, type PageEntry } from '@uw/contracts';
import type { Executor } from '@uw/db/client';
import type { PersonName } from '../../people/directory.ts';
import { FavouriteToggle } from '@uw/ui/components/chip.tsx';
import { HumanActionLink } from '@uw/ui/components/human-action.tsx';
import { Note } from '@uw/ui/components/note.tsx';
import { Table } from '@uw/ui/components/table.tsx';
import type { AppEnv } from '../../deps.ts';
import type { Rendered } from '../../markdown/render.ts';
import { draftsOf } from '../../pages/drafts.ts';
import { renderPage } from '../../pages/render-page.ts';
import type { PageVersion } from '../../pages/history.ts';
import { openComments } from '../../pages/comments.ts';
import { isFavourite } from '../../pages/favourites.ts';
import { recordView } from '../../pages/recent.ts';
import { verificationOf } from '../../pages/verification.ts';
import { personOfProfilePage } from '../../people/profile-body.ts';
import { renderScreen, screenKernel, screenRefusal, type ScreenKernel } from '../parts/frame.tsx';
import {
  backOf,
  categoryOf,
  pageLink,
  pageScreenSpec,
  shownPage,
  typeWords,
  type ShownPage,
} from '../parts/page-shown.ts';
import { PageStatusBadge, isNotLive } from '../parts/page-status.tsx';
import {
  CommentButton,
  Connected,
  MoreMenu,
  Pager,
  ReadBand,
  commentWords,
} from '../parts/page-read.tsx';
import { neighboursOf } from '../parts/wiki-tree.ts';
import { pagesInCategory } from '../../pages/categories.ts';
import { namesOf, shownIdentity } from '../parts/person-names.ts';
import { idParam } from '../parts/params.ts';
import {
  pageCommentsPath,
  pageEditPath,
  pageVersionPath,
  personPath,
  withBack,
} from '../parts/paths.ts';
import { notFound } from './not-found.tsx';
import { withViews } from '../parts/view-embed.tsx';
import type { Principal } from '@uw/core/principal';
import { shownPerson, shownText, Who, type Reading } from '../parts/person.tsx';
import { commitOf } from '../../env.ts';

function savedVersion(raw: string | undefined): number | null {
  const version = Number(raw);
  return raw !== undefined && Number.isInteger(version) && version >= 1 ? version : null;
}

function History(props: {
  readonly pageId: string;
  readonly versions: readonly PageVersion[];
  readonly reading: Reading;
}) {
  const rows = props.versions.map((entry) => ({
    version: (
      <a href={pageVersionPath(props.pageId, entry.version)} class={pageLink}>
        {String(entry.version)}
      </a>
    ),
    when: formatInstant(entry.savedAt),
    who: (
      <Who
        reading={props.reading}
        who={entry.saver === null ? shownText(entry.savedBy) : shownPerson(entry.saver)}
      />
    ),
    title: entry.title,
  }));
  const columns = [
    { key: 'version', label: 'Version', numeric: true },
    { key: 'when', label: 'Saved' },
    { key: 'who', label: 'By' },
    { key: 'title', label: 'Title' },
  ];
  return (
    <details data-history="" class="rounded-md border border-line bg-surface">
      <summary class="cursor-pointer px-4 py-3 text-sm font-heavy text-text outline-offset-2 outline-accent-text focus-visible:outline-2">
        {`History, ${String(rows.length)} ${rows.length === 1 ? 'version' : 'versions'}, newest first`}
      </summary>
      {rows.length === 0 ? (
        <p class="m-0 px-4 py-3 text-sm text-text-3">No saved versions yet.</p>
      ) : (
        <Table caption="Versions of this page" columns={columns} rows={rows} bare />
      )}
    </details>
  );
}

function Lapsed(props: { readonly shown: ShownPage; readonly at: Date }) {
  const { page } = props.shown;
  if (page.type !== 'knowledge') return null;
  const verification = verificationOf(page.frontmatter, props.at);
  if (verification.state !== 'lapsed') return null;
  return (
    <Note>{`Verification lapsed on ${verification.until}. This page may be out of date.`}</Note>
  );
}

type Extras = {
  readonly back: string | null;
  readonly saved: number | null;
  readonly rendered: Rendered;
  readonly drafted: boolean;
  readonly at: Date;
  readonly reader: Principal;
  readonly openComments: number;
  readonly favourite: boolean;
  readonly filed: readonly PageEntry[];
  readonly owner: PersonName | null;
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
      <Lapsed shown={shown} at={extras.at} />
      {extras.drafted ? (
        <Note>There is an unsaved draft of this page. You are reading it as last saved.</Note>
      ) : null}
    </>
  );
}

function facts(shown: ShownPage, extras: Extras): readonly Child[] {
  const { page } = shown;
  const reading = { reader: extras.reader, at: extras.at };
  const verification =
    page.type === 'knowledge' ? verificationOf(page.frontmatter, extras.at) : null;
  const shownFacts: Child[] = isNotLive(page) ? [<PageStatusBadge status={page.status} />] : [];
  if (extras.owner !== null) {
    shownFacts.push(
      <span>
        <Who reading={reading} who={shownPerson(extras.owner)} />
      </span>,
    );
  }
  if (verification?.state === 'verified') {
    shownFacts.push(<span>{`Verified until ${verification.until}`}</span>);
  }
  shownFacts.push(<span>{`Version ${String(page.version)} in area ${page.jdArea}`}</span>);
  shownFacts.push(
    <a href={pageCommentsPath(page.id)} class={pageLink}>
      {commentWords(extras.openComments)}
    </a>,
  );
  return shownFacts;
}

function Actions(props: { readonly shown: ShownPage; readonly extras: Extras }) {
  const { page, canEdit } = props.shown;
  return (
    <>
      <FavouriteToggle pageId={page.id} on={props.extras.favourite} compact />
      <CommentButton pageId={page.id} />
      <MoreMenu pageId={page.id} manage={canEdit && page.type === 'knowledge'} />
      {canEdit ? (
        <HumanActionLink
          href={withBack(pageEditPath(page.id), props.extras.back)}
          label="Edit"
          name="Edit this page"
          icon="pen"
        />
      ) : null}
    </>
  );
}

function markOf(shown: ShownPage): { readonly mark: string; readonly mono: boolean } {
  const filed = knowledgeFrontmatterSchema.safeParse(shown.page.frontmatter);
  const jdId = shown.page.type === 'knowledge' && filed.success ? filed.data.jd_id : null;
  if (jdId !== null) return { mark: jdId, mono: true };
  return { mark: typeWords[shown.page.type] ?? shown.page.type, mono: false };
}

type Lead = { readonly code?: string | undefined; readonly crumbs: readonly Crumb[] };

function Band(props: { readonly shown: ShownPage; readonly extras: Extras; readonly lead: Lead }) {
  const { shown, extras } = props;
  return (
    <ReadBand
      code={props.lead.code}
      crumbs={props.lead.crumbs}
      actions={<Actions shown={shown} extras={extras} />}
      {...markOf(shown)}
      title={shown.page.title}
      facts={facts(shown, extras)}
      headings={extras.rendered.headings}
    />
  );
}

function body(shown: ShownPage, extras: Extras, lead: Lead) {
  const { page } = shown;
  const category = categoryOf(page);
  const { previous, next } = neighboursOf(extras.filed, page.id);
  return (
    <>
      <Band shown={shown} extras={extras} lead={lead} />
      <div class="mx-auto flex w-full max-w-flow flex-col gap-6 pt-6">
        <Notices shown={shown} extras={extras} />
        <div data-page-sheet="">
          <div data-page-body="">{raw(extras.rendered.html)}</div>
        </div>
        {category === null ? null : <Pager category={category} previous={previous} next={next} />}
        <div class="flex flex-col gap-5 md:flex-row">
          <Connected title="Pages under this one" mark="children" pages={shown.children} />
          <Connected title="Linked from" mark="backlinks" pages={shown.backlinks} />
        </div>
        <History
          pageId={page.id}
          versions={shown.versions}
          reading={{ reader: extras.reader, at: extras.at }}
        />
      </div>
    </>
  );
}

type Stored = Pick<Extras, 'rendered' | 'openComments' | 'favourite' | 'filed' | 'owner'>;

const nothingStored: Stored = {
  rendered: { html: '', headings: [] },
  openComments: 0,
  favourite: false,
  filed: [],
  owner: null,
};

async function ownerOf(db: Executor, page: ShownPage['page']): Promise<PersonName | null> {
  const filed = knowledgeFrontmatterSchema.safeParse(page.frontmatter);
  if (page.type !== 'knowledge' || !filed.success || filed.data.owner === null) return null;
  const names = await namesOf(db, [filed.data.owner]);
  const shown = shownIdentity(filed.data.owner, names, () => '');
  return shown.kind === 'person' ? shown.person : null;
}

async function storedExtras(
  c: Context<AppEnv>,
  screen: ScreenKernel,
  shown: ShownPage,
): Promise<Stored> {
  const database = c.get('database');
  if (database === null) return nothingStored;
  const { actor } = screen.caller;
  const { page } = shown;
  const category = categoryOf(page);
  await recordView(database.db, actor, page.id, screen.at);
  return {
    rendered: await withViews(
      database.db,
      screen,
      await renderPage(database.db, actor, page, screen.at, commitOf(c.env)),
    ),
    openComments: await openComments(database.db, page.id),
    favourite: await isFavourite(database.db, actor, page.id),
    filed:
      category === null
        ? []
        : ((await pagesInCategory(database.db, actor, category, screen.at)) ?? []),
    owner: await ownerOf(database.db, page),
  };
}

async function profileOf(c: Context<AppEnv>, page: ShownPage['page']): Promise<string | null> {
  const database = c.get('database');
  if (page.type !== 'profile' || database === null) return null;
  const personId = await personOfProfilePage(database.db, page.id);
  return personId === null ? null : personPath(personId);
}

export async function pageScreen(c: Context<AppEnv>): Promise<Response> {
  const screen = screenKernel(c);
  if (screen === null) return screenRefusal(c);
  const pageId = idParam(c.req.param('pageId'));
  if (pageId === null) return notFound(c);
  const read = await screen.kernel.views.page(screen.caller, { pageId }, { at: screen.at });
  const shown = read.status === 'accepted' ? await shownPage(c, screen, pageId) : null;
  if (shown === null) return notFound(c);
  const profile = await profileOf(c, shown.page);
  if (profile !== null) return c.redirect(profile, 302);
  const draft = shown.canEdit
    ? await draftsOf(c.env)?.status(shown.page.id, shown.page.version)
    : null;
  const extras = {
    ...(await storedExtras(c, screen, shown)),
    drafted: draft?.dirty === true,
    at: screen.at,
    reader: screen.caller.actor,
    back: backOf(c.req.query('back')),
    saved: savedVersion(c.req.query('saved')),
  };
  const spec = await pageScreenSpec(c, screen, shown, null, extras.filed);
  const lead = { code: spec.code, crumbs: spec.crumbs };
  return renderScreen(c, { ...spec, bare: true }, body(shown, extras, lead));
}
