import type { Context } from 'hono';
import type { Child } from 'hono/jsx';
import { raw } from 'hono/html';
import { formatInstant } from '@uw/core/dates';
import { knowledgeFrontmatterSchema, type PageEntry } from '@uw/contracts';
import type { Executor } from '@uw/db/client';
import type { PersonName } from '../../people/directory.ts';
import { FavouriteToggle } from '@uw/ui/components/chip.tsx';
import { ButtonLink } from '@uw/ui/components/button.tsx';
import { DocumentShape } from '@uw/ui/shapes/document.tsx';
import { OverviewShape } from '@uw/ui/shapes/overview.tsx';
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
import {
  policyReading,
  policyTargets,
  type PolicyReading,
  type PolicyTarget,
} from '../../pages/policy-reading.ts';
import { ConfirmControl, confirmable } from '../parts/confirm-control.tsx';
import { PolicyFormsSection } from '../parts/policy-forms.tsx';
import { pendingSuggestions, type PendingSuggestion } from '../../pages/suggestions.ts';
import { verificationOf } from '../../pages/verification.ts';
import { PolicyConflicts, SuggestionsWaiting, policyFacts } from '../parts/policy-facts.tsx';
import { personOfProfilePage } from '../../people/profile-body.ts';
import { renderScreen, screenKernel, screenRefusal, type ScreenKernel } from '../parts/frame.tsx';
import {
  backOf,
  categoryOf,
  pageLink,
  pageScreenSpec,
  markOf,
  shownPage,
  type ShownPage,
} from '../parts/page-shown.ts';
import { PageStatusLine, pageFacts } from '../parts/page-status.tsx';
import {
  CommentButton,
  Connected,
  Contents,
  MoreMenu,
  PageBand,
  Pager,
  Properties,
  commentWords,
  type Fact,
} from '../parts/page-read.tsx';
import { neighboursOf } from '../parts/wiki-tree.ts';
import { printedPage } from '../parts/page-printed.ts';
import { pagesInCategory } from '../../pages/categories.ts';
import { namesOf, shownIdentity } from '../parts/person-names.ts';
import { idParam } from '../parts/params.ts';
import {
  dashboardJsonPath,
  pageCommentsPath,
  pageEditPath,
  pageVersionPath,
  personPath,
  withBack,
} from '../parts/paths.ts';
import { notFound } from './not-found.tsx';
import { withViews } from '../parts/view-embed.tsx';
import { withPanels } from '../parts/dashboard-panels.tsx';
import { measureParts } from '../parts/measure-section.tsx';
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
    <details data-history="" data-pdf-hidden="" class="flex flex-col gap-3">
      <summary class="cursor-pointer text-sm font-semibold text-text-2 outline-offset-2 outline-accent-text hover:text-text focus-visible:outline-2">
        {`History, ${String(rows.length)} ${rows.length === 1 ? 'version' : 'versions'}, newest first`}
      </summary>
      {rows.length === 0 ? (
        <p class="m-0 pt-3 text-sm text-text-3">No saved versions yet.</p>
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
  readonly measures: Child;
  readonly policy: PolicyReading | null;
  readonly suggestions: readonly PendingSuggestion[];
  readonly targets: readonly PolicyTarget[];
  readonly refused: string | null;
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
      <SuggestionsWaiting pageId={shown.page.id} suggestions={extras.suggestions} />
      {extras.policy === null ? null : <PolicyConflicts conflicts={extras.policy.conflicts} />}
      {extras.drafted ? (
        <Note>There is an unsaved draft of this page. You are reading it as last saved.</Note>
      ) : null}
    </>
  );
}

function facts(shown: ShownPage, extras: Extras): readonly Fact[] {
  const { page } = shown;
  const reading = { reader: extras.reader, at: extras.at };
  const verification =
    page.type === 'knowledge' ? verificationOf(page.frontmatter, extras.at) : null;
  const shownFacts: Fact[] = [];
  if (extras.owner !== null) {
    shownFacts.push({
      label: 'Owner',
      value: <Who reading={reading} who={shownPerson(extras.owner)} />,
    });
  }
  if (verification?.state === 'verified') {
    shownFacts.push({ label: 'Verification', value: `Verified until ${verification.until}` });
  }
  shownFacts.push(...pageFacts(page));
  if (extras.policy !== null) shownFacts.push(...policyFacts(extras.policy));
  shownFacts.push({
    label: 'Comments',
    value: (
      <a href={pageCommentsPath(page.id)} class={pageLink}>
        {commentWords(extras.openComments)}
      </a>
    ),
  });
  return shownFacts;
}

function Actions(props: { readonly shown: ShownPage; readonly extras: Extras }) {
  const { page, canEdit } = props.shown;
  return (
    <>
      <FavouriteToggle pageId={page.id} on={props.extras.favourite} compact />
      <CommentButton pageId={page.id} />
      <MoreMenu
        pageId={page.id}
        manage={canEdit && page.type === 'knowledge'}
        subpages={props.shown.children.length > 0}
      />
      {canEdit ? (
        <ButtonLink
          href={withBack(pageEditPath(page.id), props.extras.back)}
          label="Edit this page"
          icon="pen"
        >
          Edit
        </ButtonLink>
      ) : null}
    </>
  );
}

function Rail(props: { readonly shown: ShownPage; readonly extras: Extras }) {
  const { shown, extras } = props;
  return (
    <>
      <Properties facts={facts(shown, extras)} />
      <Contents headings={extras.rendered.headings} />
      <Connected title="Pages under this one" mark="children" pages={shown.children} />
      <Connected title="Linked from" mark="backlinks" pages={shown.backlinks} />
    </>
  );
}

function dashboardBody(shown: ShownPage, extras: Extras) {
  const { page } = shown;
  return (
    <OverviewShape
      head={{
        eyebrow: markOf(page),
        title: page.title,
        actions: <Actions shown={shown} extras={extras} />,
      }}
    >
      <PageStatusLine page={page} />
      <Notices shown={shown} extras={extras} />
      {extras.measures}
      <div data-page-sheet="">
        <div data-page-body="">{raw(extras.rendered.html)}</div>
      </div>
      <p data-pdf-hidden="" class="m-0 text-sm">
        <a href={dashboardJsonPath(page.id)} class={pageLink}>
          The figures of this dashboard as JSON
        </a>
      </p>
      <History
        pageId={page.id}
        versions={shown.versions}
        reading={{ reader: extras.reader, at: extras.at }}
      />
    </OverviewShape>
  );
}

const bodies: ReadonlyMap<string, (shown: ShownPage, extras: Extras) => Child> = new Map([
  ['dashboard', dashboardBody],
]);

function body(shown: ShownPage, extras: Extras) {
  const { page } = shown;
  const category = categoryOf(page);
  const { previous, next } = neighboursOf(extras.filed, page.id);
  return (
    <DocumentShape
      band={
        <PageBand
          status={<PageStatusLine page={page} />}
          actions={<Actions shown={shown} extras={extras} />}
        />
      }
      head={{ eyebrow: markOf(page), title: page.title }}
      rail={<Rail shown={shown} extras={extras} />}
    >
      <Notices shown={shown} extras={extras} />
      <div data-page-sheet="">
        <div data-page-body="">{raw(extras.rendered.html)}</div>
      </div>
      {extras.measures}
      {category === null ? null : <Pager category={category} previous={previous} next={next} />}
      <ConfirmControl
        page={page}
        shown={confirmable(page, shown.canEdit, extras.reader.kind === 'person')}
        refused={extras.refused}
      />
      <PolicyFormsSection
        forms={
          extras.policy === null
            ? null
            : {
                page,
                reading: extras.policy,
                canEdit: shown.canEdit,
                targets: extras.targets,
                at: extras.at,
              }
        }
        refused={
          confirmable(page, shown.canEdit, extras.reader.kind === 'person') ? null : extras.refused
        }
      />
      <History
        pageId={page.id}
        versions={shown.versions}
        reading={{ reader: extras.reader, at: extras.at }}
      />
    </DocumentShape>
  );
}

type Stored = Pick<
  Extras,
  | 'rendered'
  | 'openComments'
  | 'favourite'
  | 'filed'
  | 'owner'
  | 'measures'
  | 'policy'
  | 'suggestions'
  | 'targets'
>;

const nothingStored: Stored = {
  rendered: { html: '', headings: [] },
  openComments: 0,
  favourite: false,
  filed: [],
  owner: null,
  measures: null,
  policy: null,
  suggestions: [],
  targets: [],
};

async function ownerOf(db: Executor, page: ShownPage['page']): Promise<PersonName | null> {
  const filed = knowledgeFrontmatterSchema.safeParse(page.frontmatter);
  if (page.type !== 'knowledge' || !filed.success || filed.data.owner === null) return null;
  const names = await namesOf(db, [filed.data.owner]);
  const shown = shownIdentity(filed.data.owner, names, () => '');
  return shown.kind === 'person' ? shown.person : null;
}

async function policyExtras(
  db: Executor,
  reader: { readonly actor: Principal; readonly at: Date },
  shown: ShownPage,
): Promise<Pick<Stored, 'policy' | 'targets'>> {
  const policy = await policyReading(db, reader, shown.page);
  const copies = policy?.enforcement === 'template' && shown.canEdit;
  return { policy, targets: copies ? await policyTargets(db, reader) : [] };
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
  const rendered = await withViews(
    database.db,
    screen,
    await renderPage(database.db, actor, page, screen.at, commitOf(c.env)),
  );
  return {
    rendered: await withPanels(database.db, screen, page, rendered),
    measures: await measureParts(database.db, screen, page),
    openComments: await openComments(database.db, page.id),
    favourite: await isFavourite(database.db, actor, page.id),
    filed:
      category === null
        ? []
        : ((await pagesInCategory(database.db, actor, category, screen.at)) ?? []),
    owner: await ownerOf(database.db, page),
    ...(await policyExtras(database.db, { actor, at: screen.at }, shown)),
    suggestions: await pendingSuggestions(database.db, actor, page, screen.at),
  };
}

async function profileOf(c: Context<AppEnv>, page: ShownPage['page']): Promise<string | null> {
  const database = c.get('database');
  if (page.type !== 'profile' || database === null) return null;
  const personId = await personOfProfilePage(database.db, page.id);
  return personId === null ? null : personPath(personId);
}

function reasonParam(raw: string | undefined): string | null {
  return raw !== undefined && /^[a-z_]{1,60}$/.test(raw) ? raw : null;
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
    refused: reasonParam(c.req.query('refused')),
  };
  const spec = await pageScreenSpec(c, screen, shown, null, extras.filed);
  const printed = await printedPage(c, shown.page);
  const draw = bodies.get(shown.page.type) ?? body;
  return renderScreen(c, { ...spec, ...printed }, draw(shown, extras));
}
