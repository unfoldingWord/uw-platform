import type { Context } from 'hono';
import { raw } from 'hono/html';
import { updatePageCommandSchema } from '@uw/contracts';
import { formatInstant } from '@uw/core/dates';
import { Button } from '@uw/ui/components/button.tsx';
import { TextField } from '@uw/ui/components/field.tsx';
import { Note } from '@uw/ui/components/note.tsx';
import { Section } from '@uw/ui/components/section.tsx';
import { DocumentShape } from '@uw/ui/shapes/document.tsx';
import { reasonText } from '@uw/ui/components/text.ts';
import type { AppEnv } from '../../deps.ts';
import { pageVersion, type PageSnapshot } from '../../pages/history.ts';
import { renderPage } from '../../pages/render-page.ts';
import { measurePauses } from '../../measures/activations.ts';
import { updatePageWith } from '../../pages/store.ts';
import { renderScreen, screenKernel, screenRefusal, type ScreenKernel } from '../parts/frame.tsx';
import { pageNames } from '../parts/names.ts';
import {
  markOf,
  pageLink,
  pageScreenSpec,
  shownPage,
  type ShownPage,
} from '../parts/page-shown.ts';
import { printedPage } from '../parts/page-printed.ts';
import { LineChanges } from '../parts/line-changes.tsx';
import { WordChanges } from '../parts/word-changes.tsx';
import { PageBand } from '../parts/page-read.tsx';
import { idParam } from '../parts/params.ts';
import { pagePath, pageVersionPath } from '../parts/paths.ts';
import { shownPerson, shownText, Who, type Reading } from '../parts/person.tsx';
import { notFound } from './not-found.tsx';
import { commitOf } from '../../env.ts';

type Kept = Pick<PageSnapshot, 'page'> & {
  readonly saved: Pick<PageSnapshot, 'savedAt' | 'savedBy' | 'saver'> | null;
};

type Old = {
  readonly screen: ScreenKernel;
  readonly shown: ShownPage;
  readonly snapshot: Kept;
  readonly against: Kept['page'] | null;
  readonly mode: DiffMode;
};

type DiffMode = 'lines' | 'words';

type Comparison = {
  readonly before: Kept['page'];
  readonly after: Kept['page'];
  readonly mode: DiffMode;
};

function comparePath(old: Old, compare: Comparison, mode: DiffMode): string {
  const { shown, snapshot } = old;
  const against = snapshot.page.version === compare.before.version ? compare.after : compare.before;
  const query = new URLSearchParams({ against: String(against.version), diff: mode });
  return `${pageVersionPath(shown.page.id, snapshot.page.version)}?${query.toString()}`;
}

function ModeLink(props: { readonly old: Old; readonly compare: Comparison }) {
  const { old, compare } = props;
  const other: DiffMode = compare.mode === 'words' ? 'lines' : 'words';
  return (
    <p class="m-0">
      <a href={comparePath(old, compare, other)} class={pageLink} data-diff-mode={other}>
        {other === 'words' ? 'Compare word by word' : 'Compare line by line'}
      </a>
    </p>
  );
}

function Changes(props: { readonly old: Old; readonly compare: Comparison }) {
  const { compare } = props;
  const { before, after } = compare;
  const same = 'The two versions have the same text.';
  return (
    <Section
      title="Changes"
      sub={`From version ${String(before.version)} to version ${String(after.version)}`}
    >
      <ModeLink old={props.old} compare={compare} />
      {compare.mode === 'words' ? (
        <WordChanges before={before.bodyMd} after={after.bodyMd} same={same} />
      ) : (
        <LineChanges before={before.bodyMd} after={after.bodyMd} same={same} />
      )}
    </Section>
  );
}

function CompareForm(props: { readonly old: Old; readonly mode: DiffMode }) {
  const { shown, snapshot } = props.old;
  return (
    <form
      method="get"
      action={pageVersionPath(shown.page.id, snapshot.page.version)}
      class="flex flex-wrap items-end gap-3"
      data-compare-versions=""
    >
      <input type="hidden" name="diff" value={props.mode} />
      <TextField
        name="against"
        label="Compare with version"
        scope={shown.page.id}
        maxLength={9}
        value={String(shown.page.version)}
      />
      <Button type="submit" variant="secondary">
        Compare
      </Button>
    </form>
  );
}

function Restore(props: { readonly old: Old }) {
  const { shown, snapshot } = props.old;
  return (
    <Section title="Restore" sub="Saves this text and title as a new version. Nothing is deleted">
      <form
        method="post"
        action={pageVersionPath(shown.page.id, snapshot.page.version)}
        class="flex flex-col gap-4"
      >
        <input type="hidden" name="expectedVersion" value={String(shown.page.version)} />
        <input type="hidden" name="requestId" value={crypto.randomUUID()} />
        <p class="m-0">
          <Button type="submit">Restore this version</Button>
        </p>
      </form>
    </Section>
  );
}

async function snapshotOf(c: Context<AppEnv>, screen: ScreenKernel, shown: ShownPage) {
  const database = c.get('database');
  const version = Number(c.req.param('version'));
  if (database === null || !Number.isInteger(version) || version < 1) return null;
  const key = { pageId: shown.page.id, version };
  const kept = await pageVersion(database.db, screen.caller.actor, key, screen.at);
  if (kept !== null) return { page: kept.page, saved: kept };
  return version === shown.page.version ? { page: shown.page, saved: null } : null;
}

async function againstOf(
  c: Context<AppEnv>,
  screen: ScreenKernel,
  shown: ShownPage,
): Promise<Kept['page'] | null> {
  const database = c.get('database');
  const asked = Number(c.req.query('against') ?? shown.page.version);
  if (database === null || !Number.isInteger(asked) || asked < 1) return null;
  if (asked === shown.page.version) return shown.page;
  const key = { pageId: shown.page.id, version: asked };
  return (await pageVersion(database.db, screen.caller.actor, key, screen.at))?.page ?? null;
}

async function oldOf(c: Context<AppEnv>): Promise<Old | null> {
  const screen = screenKernel(c);
  const pageId = idParam(c.req.param('pageId'));
  if (screen === null || pageId === null) return null;
  const shown = await shownPage(c, screen, pageId);
  if (shown === null) return null;
  const snapshot = await snapshotOf(c, screen, shown);
  if (snapshot === null) return null;
  const mode: DiffMode = c.req.query('diff') === 'words' ? 'words' : 'lines';
  return { screen, shown, snapshot, against: await againstOf(c, screen, shown), mode };
}

function comparisonOf(old: Old): Comparison | null {
  const { snapshot, against, mode } = old;
  if (against === null || against.version === snapshot.page.version) return null;
  const older = against.version < snapshot.page.version;
  return older
    ? { before: against, after: snapshot.page, mode }
    : { before: snapshot.page, after: against, mode };
}

function SavedBy(props: { readonly saved: Kept['saved']; readonly reading: Reading }) {
  const { saved } = props;
  if (saved === null) return null;
  return (
    <p class="m-0 flex flex-wrap items-center gap-2">
      <span>Saved by</span>
      <Who
        reading={props.reading}
        who={saved.saver === null ? shownText(saved.savedBy) : shownPerson(saved.saver)}
      />
    </p>
  );
}

function ledeOf(snapshot: Kept): string {
  const version = `Version ${String(snapshot.page.version)}`;
  if (snapshot.saved === null) return `${version}, the current version.`;
  return `${version}, saved ${formatInstant(snapshot.saved.savedAt)}.`;
}

async function render(c: Context<AppEnv>, old: Old, refused: string | null): Promise<Response> {
  const { screen, shown, snapshot } = old;
  const database = c.get('database');
  const { actor } = screen.caller;
  const rendered =
    database === null
      ? { html: '', headings: [] }
      : await renderPage(database.db, actor, snapshot.page, screen.at, commitOf(c.env));
  const current = snapshot.page.version === shown.page.version;
  const compare = comparisonOf(old);
  const label = `${pageNames.pageVersion} ${String(snapshot.page.version)}`;
  const spec = await pageScreenSpec(c, screen, shown, label);
  return renderScreen(
    c,
    { ...spec, ...(await printedPage(c, snapshot.page)) },
    <DocumentShape
      band={
        <PageBand
          status={<SavedBy saved={snapshot.saved} reading={{ reader: actor, at: screen.at }} />}
          actions={
            <a href={pagePath(shown.page.id)} class={pageLink}>
              {current ? 'This is the current version' : 'Back to the current version'}
            </a>
          }
        />
      }
      head={{ eyebrow: markOf(shown.page), title: snapshot.page.title, lede: ledeOf(snapshot) }}
    >
      {refused === null ? null : <Note>{`Not restored: ${reasonText(refused)}.`}</Note>}
      <div data-page-body="">{raw(rendered.html)}</div>
      <div data-pdf-hidden="" class="flex flex-col gap-4">
        <CompareForm old={old} mode={old.mode} />
        {compare === null ? null : <Changes old={old} compare={compare} />}
      </div>
      {current || !shown.canEdit ? null : <Restore old={old} />}
    </DocumentShape>,
  );
}

export async function pageVersionScreen(c: Context<AppEnv>): Promise<Response> {
  if (screenKernel(c) === null) return screenRefusal(c);
  const old = await oldOf(c);
  return old === null ? notFound(c) : render(c, old, null);
}

export async function restoreVersion(c: Context<AppEnv>): Promise<Response> {
  if (screenKernel(c) === null) return screenRefusal(c);
  const old = await oldOf(c);
  const database = c.get('database');
  if (old === null || database === null || !old.shown.canEdit) return notFound(c);
  const posted = await c.req.parseBody();
  const { page } = old.shown;
  const command = updatePageCommandSchema.safeParse({
    command: 'update_page',
    requestId: posted['requestId'],
    pageId: page.id,
    expectedVersion: Number(posted['expectedVersion']),
    slug: page.slug,
    title: old.snapshot.page.title,
    parentId: page.parentId,
    frontmatter: page.frontmatter,
    bodyMd: old.snapshot.page.bodyMd,
    status: page.status,
  });
  if (!command.success) return render(c, old, 'malformed_command');
  const { actor, traceId } = old.screen.caller;
  const saved = await updatePageWith(database.db, actor, command.data, {
    traceId,
    at: old.screen.at,
    effects: measurePauses,
  });
  if (!saved.ok) return render(c, old, saved.reason);
  return c.redirect(`${pagePath(page.id)}?saved=${String(saved.page.version)}`, 303);
}
