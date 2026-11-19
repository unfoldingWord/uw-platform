import type { Context } from 'hono';
import type { Page } from '@uw/contracts';
import { can } from '@uw/core/acl';
import { formatInstant } from '@uw/core/dates';
import { Card } from '@uw/ui/components/card.tsx';
import { primaryButton } from '@uw/ui/components/command-form.tsx';
import { TextAreaField, TextField } from '@uw/ui/components/field.tsx';
import { Note } from '@uw/ui/components/note.tsx';
import { PageHead } from '@uw/ui/components/page-head.tsx';
import { Table } from '@uw/ui/components/table.tsx';
import { reasonText } from '@uw/ui/components/text.ts';
import type { AppEnv } from '../../deps.ts';
import { pageHistory, type PageVersion } from '../../pages/history.ts';
import { readPage } from '../../pages/store.ts';
import { renderScreen, screenKernel, screenRefusal, type ScreenKernel } from '../parts/frame.tsx';
import { moduleCodes, pageNames } from '../parts/names.ts';
import { idParam } from '../parts/params.ts';
import { agentQueuesPath, pagePath } from '../parts/paths.ts';
import { notFound } from './not-found.tsx';

export type PageNotice =
  { readonly kind: 'saved' } | { readonly kind: 'refused'; readonly reason: string } | null;

const link =
  'font-heavy text-accent-text underline outline-offset-2 outline-accent-text focus-visible:outline-2';

const typeWords: Readonly<Record<string, string>> = {
  skill: 'Instructions page',
  persona: 'Agent page',
  learning: 'Learning',
};

const BACK = /^\/harnesses\/[0-9a-f-]{36}\/controls$/;

export function backOf(raw: string | undefined): string | null {
  return raw !== undefined && BACK.test(raw) ? raw : null;
}

function noticeText(notice: PageNotice): string | null {
  if (notice === null) return null;
  if (notice.kind === 'saved') return 'Saved as a new version.';
  if (notice.reason === 'stale_version') {
    return 'Someone saved a newer version. Reload the page to see it before you change it.';
  }
  const why = reasonText(notice.reason);
  return `Not saved: ${why}.`;
}

function Editor(props: { readonly page: Page; readonly back: string | null }) {
  const { page, back } = props;
  return (
    <Card title="Edit this page" sub="Each save is kept as a new version with your name">
      <form method="post" action={pagePath(page.id)} class="flex flex-col gap-4">
        <input type="hidden" name="expectedVersion" value={String(page.version)} />
        <input type="hidden" name="requestId" value={crypto.randomUUID()} />
        {back === null ? null : <input type="hidden" name="back" value={back} />}
        <TextField name="title" label="Title" scope={page.id} value={page.title} maxLength={200} />
        <TextAreaField
          name="bodyMd"
          label="Text"
          scope={page.id}
          value={page.bodyMd}
          rows={16}
          maxLength={1_000_000}
          hint="Agents at a stage using this page receive this text as their instructions."
        />
        <p class="m-0">
          <button type="submit" class={primaryButton}>
            Save
          </button>
        </p>
      </form>
    </Card>
  );
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

type Shown = {
  readonly page: Page;
  readonly versions: readonly PageVersion[];
  readonly canEdit: boolean;
  readonly back: string | null;
  readonly notice: PageNotice;
};

function body(shown: Shown) {
  const { page, back } = shown;
  const notice = noticeText(shown.notice);
  return (
    <>
      <PageHead
        eyebrow={typeWords[page.type] ?? page.type}
        title={page.title}
        lede={`Version ${String(page.version)} in area ${page.jdArea}.`}
      />
      <div class="flex flex-col gap-5">
        {back === null ? null : (
          <p class="m-0">
            <a href={back} class={link}>
              Back to Stages & Controls
            </a>
          </p>
        )}
        {notice === null ? null : <Note>{notice}</Note>}
        {shown.canEdit ? (
          <Editor page={page} back={back} />
        ) : (
          <Card title="Text">
            <pre class="m-0 font-sans text-sm whitespace-pre-wrap text-text">{page.bodyMd}</pre>
          </Card>
        )}
        <History versions={shown.versions} />
      </div>
    </>
  );
}

export async function renderPage(
  c: Context<AppEnv>,
  screen: ScreenKernel,
  pageId: string,
  options: { readonly back: string | null; readonly notice: PageNotice },
): Promise<Response> {
  const database = c.get('database');
  if (database === null) return screenRefusal(c);
  const { actor } = screen.caller;
  const page = await readPage(database.db, actor, pageId, screen.at);
  const versions = await pageHistory(database.db, actor, pageId, screen.at);
  if (page === null || versions === null) return notFound(c);
  const canEdit = can(actor, 'write', { kind: 'area', area: page.jdArea }, screen.at);
  const spec = {
    title: page.title,
    current: pagePath(page.id),
    code: moduleCodes.agentQueues,
    crumbs: [{ label: pageNames.agentQueues, href: agentQueuesPath() }, { label: pageNames.page }],
  };
  return renderScreen(c, spec, body({ page, versions, canEdit, ...options }));
}

export async function pageScreen(c: Context<AppEnv>): Promise<Response> {
  const screen = screenKernel(c);
  if (screen === null) return screenRefusal(c);
  const pageId = idParam(c.req.param('pageId'));
  if (pageId === null) return notFound(c);
  const read = await screen.kernel.views.page(screen.caller, { pageId }, { at: screen.at });
  if (read.status !== 'accepted') return notFound(c);
  return renderPage(c, screen, pageId, { back: backOf(c.req.query('back')), notice: null });
}
