import type { Context } from 'hono';
import { raw } from 'hono/html';
import { formatInstant } from '@uw/core/dates';
import { Card } from '@uw/ui/components/card.tsx';
import { HumanActionLink } from '@uw/ui/components/human-action.tsx';
import { Note } from '@uw/ui/components/note.tsx';
import { PageHead } from '@uw/ui/components/page-head.tsx';
import { Table } from '@uw/ui/components/table.tsx';
import type { AppEnv } from '../../deps.ts';
import { renderMarkdown, type Heading } from '../../markdown/render.ts';
import type { PageVersion } from '../../pages/history.ts';
import { renderScreen, screenKernel, screenRefusal } from '../parts/frame.tsx';
import {
  backOf,
  pageLink,
  pageSpec,
  shownPage,
  typeWords,
  type ShownPage,
} from '../parts/page-shown.ts';
import { idParam } from '../parts/params.ts';
import { pageEditPath, pagePath, withBack } from '../parts/paths.ts';
import { notFound } from './not-found.tsx';

const MIN_CONTENTS = 2;
const tocLink =
  'block rounded-sm py-1 text-sm font-semibold text-text-2 outline-offset-2 outline-accent-text hover:text-accent-text focus-visible:outline-2';

function savedVersion(raw: string | undefined): number | null {
  const version = Number(raw);
  return raw !== undefined && Number.isInteger(version) && version >= 1 ? version : null;
}

function History(props: { readonly versions: readonly PageVersion[] }) {
  const rows = props.versions.map((entry) => ({
    version: String(entry.version),
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

function Children(props: { readonly shown: ShownPage }) {
  const { children } = props.shown;
  if (children.length === 0) return null;
  return (
    <Card title="Pages under this one">
      <ul data-children="" class="m-0 flex list-none flex-col gap-1 p-0">
        {children.map((child) => (
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

function body(shown: ShownPage, back: string | null, saved: number | null) {
  const { page } = shown;
  const rendered = renderMarkdown(page.bodyMd);
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
        actions={pencil}
      />
      <div class="flex flex-col gap-5">
        {back === null ? null : (
          <p class="m-0">
            <a href={back} class={pageLink}>
              Back to Stages & Controls
            </a>
          </p>
        )}
        {saved === null ? null : <Note>{`Saved as version ${String(saved)}.`}</Note>}
        <div class="flex flex-col gap-5 lg:flex-row lg:items-start">
          <div class="min-w-0 flex-1">
            <Card>
              <div data-page-body="">{raw(rendered.html)}</div>
            </Card>
          </div>
          <Contents headings={rendered.headings} />
        </div>
        <Children shown={shown} />
        <History versions={shown.versions} />
      </div>
    </>
  );
}

export async function pageScreen(c: Context<AppEnv>): Promise<Response> {
  const screen = screenKernel(c);
  if (screen === null) return screenRefusal(c);
  const pageId = idParam(c.req.param('pageId'));
  if (pageId === null) return notFound(c);
  const read = await screen.kernel.views.page(screen.caller, { pageId }, { at: screen.at });
  const shown = read.status === 'accepted' ? await shownPage(c, screen, pageId) : null;
  if (shown === null) return notFound(c);
  const spec = pageSpec(shown, null);
  const back = backOf(c.req.query('back'));
  return renderScreen(c, spec, body(shown, back, savedVersion(c.req.query('saved'))));
}
