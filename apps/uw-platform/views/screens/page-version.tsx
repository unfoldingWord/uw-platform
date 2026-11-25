import type { Context } from 'hono';
import { raw } from 'hono/html';
import { updatePageCommandSchema } from '@uw/contracts';
import { formatInstant } from '@uw/core/dates';
import { Button } from '@uw/ui/components/button.tsx';
import { Note } from '@uw/ui/components/note.tsx';
import { Section } from '@uw/ui/components/section.tsx';
import { DocumentShape } from '@uw/ui/shapes/document.tsx';
import { reasonText } from '@uw/ui/components/text.ts';
import type { AppEnv } from '../../deps.ts';
import { lineChanges, type LineChange } from '../../pages/diff.ts';
import { pageVersion, type PageSnapshot } from '../../pages/history.ts';
import { renderPage } from '../../pages/render-page.ts';
import { updatePage } from '../../pages/store.ts';
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
};

const line = 'block rounded-sm px-3 py-1 font-mono text-xs whitespace-pre-wrap no-underline';
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
    <Section
      title="Changed since"
      sub={`From version ${String(snapshot.page.version)} to version ${String(shown.page.version)}`}
    >
      {changes === null ? (
        <p class="m-0 text-sm text-text-2">These versions are too long to compare line by line.</p>
      ) : differs ? (
        <div data-changes="" class="-mx-3 flex flex-col">
          {changes.map((change) => (
            <Line change={change} />
          ))}
        </div>
      ) : (
        <p class="m-0 text-sm text-text-2">The text is the same as the current version.</p>
      )}
    </Section>
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
      {current ? null : (
        <div data-pdf-hidden="">
          <Changes old={old} />
        </div>
      )}
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
  const saved = await updatePage(database.db, actor, command.data, traceId, old.screen.at);
  if (!saved.ok) return render(c, old, saved.reason);
  return c.redirect(`${pagePath(page.id)}?saved=${String(saved.page.version)}`, 303);
}
