import type { Context } from 'hono';
import { raw } from 'hono/html';
import { updatePageCommandSchema } from '@uw/contracts';
import { formatInstant } from '@uw/core/dates';
import { Card } from '@uw/ui/components/card.tsx';
import { commandButton } from '@uw/ui/components/command-form.tsx';
import { Note } from '@uw/ui/components/note.tsx';
import { PageHead } from '@uw/ui/components/page-head.tsx';
import { reasonText } from '@uw/ui/components/text.ts';
import type { AppEnv } from '../../deps.ts';
import { lineChanges, type LineChange } from '../../pages/diff.ts';
import { pageVersion, type PageSnapshot } from '../../pages/history.ts';
import { renderPage } from '../../pages/render-page.ts';
import { updatePage } from '../../pages/store.ts';
import { renderScreen, screenKernel, screenRefusal, type ScreenKernel } from '../parts/frame.tsx';
import { pageNames } from '../parts/names.ts';
import {
  pageLink,
  pageScreenSpec,
  shownPage,
  typeWords,
  type ShownPage,
} from '../parts/page-shown.ts';
import { printedPage } from '../parts/page-printed.ts';
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
};

const line = 'block px-3 py-1 font-mono text-xs whitespace-pre-wrap no-underline';
const looks: Readonly<Record<LineChange['kind'], string>> = {
  same: `${line} text-text-3`,
  added: `${line} bg-ok-soft text-ok-text`,
  removed: `${line} bg-raised text-text-3 line-through`,
};

function Line(props: { readonly change: LineChange }) {
  const { change } = props;
  if (change.kind === 'added') return <ins class={looks.added}>{change.text}</ins>;
  if (change.kind === 'removed') return <del class={looks.removed}>{change.text}</del>;
  return <span class={looks.same}>{change.text}</span>;
}

function Changes(props: { readonly old: Old }) {
  const { shown, snapshot } = props.old;
  const changes = lineChanges(snapshot.page.bodyMd, shown.page.bodyMd);
  const differs = changes?.some((change) => change.kind !== 'same') ?? true;
  return (
    <Card
      title="Changed since"
      sub={`From version ${String(snapshot.page.version)} to version ${String(shown.page.version)}`}
      flush
    >
      {changes === null ? (
        <p class="m-0 px-4 py-3 text-sm text-text-2">
          These versions are too long to compare line by line.
        </p>
      ) : differs ? (
        <div data-changes="" class="flex flex-col py-2">
          {changes.map((change) => (
            <Line change={change} />
          ))}
        </div>
      ) : (
        <p class="m-0 px-4 py-3 text-sm text-text-2">
          The text is the same as the current version.
        </p>
      )}
    </Card>
  );
}

function Restore(props: { readonly old: Old }) {
  const { shown, snapshot } = props.old;
  return (
    <Card title="Restore" sub="Saves this text and title as a new version. Nothing is deleted">
      <form
        method="post"
        action={pageVersionPath(shown.page.id, snapshot.page.version)}
        class="flex flex-col gap-4"
      >
        <input type="hidden" name="expectedVersion" value={String(shown.page.version)} />
        <input type="hidden" name="requestId" value={crypto.randomUUID()} />
        <p class="m-0">
          <button type="submit" class={commandButton}>
            Restore this version
          </button>
        </p>
      </form>
    </Card>
  );
}

async function oldOf(c: Context<AppEnv>): Promise<Old | null> {
  const screen = screenKernel(c);
  const database = c.get('database');
  const pageId = idParam(c.req.param('pageId'));
  const version = Number(c.req.param('version'));
  if (screen === null || database === null || pageId === null) return null;
  if (!Number.isInteger(version) || version < 1) return null;
  const shown = await shownPage(c, screen, pageId);
  if (shown === null) return null;
  const { actor } = screen.caller;
  const kept = await pageVersion(database.db, actor, { pageId, version }, screen.at);
  if (kept !== null) return { screen, shown, snapshot: { page: kept.page, saved: kept } };
  if (version !== shown.page.version) return null;
  return { screen, shown, snapshot: { page: shown.page, saved: null } };
}

function SavedBy(props: { readonly saved: Kept['saved']; readonly reading: Reading }) {
  const { saved } = props;
  if (saved === null) return null;
  return (
    <p class="m-0 flex flex-wrap items-center gap-2 text-sm text-text-3">
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
  const label = `${pageNames.pageVersion} ${String(snapshot.page.version)}`;
  const spec = await pageScreenSpec(c, screen, shown, label);
  return renderScreen(
    c,
    { ...spec, ...(await printedPage(c, snapshot.page)) },
    <>
      <PageHead
        eyebrow={typeWords[shown.page.type] ?? shown.page.type}
        title={snapshot.page.title}
        lede={ledeOf(snapshot)}
      />
      <div class="flex flex-col gap-5">
        {refused === null ? null : <Note>{`Not restored: ${reasonText(refused)}.`}</Note>}
        <SavedBy saved={snapshot.saved} reading={{ reader: actor, at: screen.at }} />
        <p class="m-0">
          <a href={pagePath(shown.page.id)} class={pageLink}>
            {current ? 'This is the current version' : 'Back to the current version'}
          </a>
        </p>
        <Card>
          <div data-page-body="">{raw(rendered.html)}</div>
        </Card>
        {current ? null : (
          <div data-pdf-hidden="">
            <Changes old={old} />
          </div>
        )}
        {current || !shown.canEdit ? null : <Restore old={old} />}
      </div>
    </>,
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
  const saved = await updatePage(database.db, actor, command.data, traceId, old.screen.at);
  if (!saved.ok) return render(c, old, saved.reason);
  return c.redirect(`${pagePath(page.id)}?saved=${String(saved.page.version)}`, 303);
}
