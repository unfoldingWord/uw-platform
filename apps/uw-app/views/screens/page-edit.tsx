import type { Context } from 'hono';
import type { Page } from '@uw/contracts';
import { Card } from '@uw/ui/components/card.tsx';
import { commandButton, primaryButton } from '@uw/ui/components/command-form.tsx';
import { TextAreaField, TextField } from '@uw/ui/components/field.tsx';
import { Note } from '@uw/ui/components/note.tsx';
import { PageHead } from '@uw/ui/components/page-head.tsx';
import { reasonText } from '@uw/ui/components/text.ts';
import type { AppEnv } from '../../deps.ts';
import { renderScreen, screenKernel, screenRefusal, type ScreenKernel } from '../parts/frame.tsx';
import { pageNames } from '../parts/names.ts';
import { backOf, pageLink, pageSpec, shownPage, typeWords } from '../parts/page-shown.ts';
import { idParam } from '../parts/params.ts';
import { pageEditPath, pagePath, withBack } from '../parts/paths.ts';
import { notFound } from './not-found.tsx';

const BODY_ROWS = 24;
const instructionsHint =
  'Agents at a stage using this page receive this text as their instructions.';
const markdownHint = 'Write in markdown. Nothing changes for readers until you save.';

export type Typed = {
  readonly title: string;
  readonly bodyMd: string;
  readonly expectedVersion: number;
};

export type EditOptions = {
  readonly back: string | null;
  readonly refused: string | null;
  readonly typed: Typed | null;
};

function refusalText(reason: string): string {
  if (reason === 'stale_version') {
    return 'Someone saved a newer version. Your text is kept below; copy what you need, then reload to edit the newest version.';
  }
  return `Not saved: ${reasonText(reason)}.`;
}

function EditForm(props: { readonly page: Page; readonly options: EditOptions }) {
  const { page, options } = props;
  const typed = options.typed ?? {
    title: page.title,
    bodyMd: page.bodyMd,
    expectedVersion: page.version,
  };
  return (
    <Card title="Edit this page" sub="Saving keeps a new version with your name">
      <form method="post" action={pageEditPath(page.id)} class="flex flex-col gap-4">
        <input type="hidden" name="expectedVersion" value={String(typed.expectedVersion)} />
        <input type="hidden" name="requestId" value={crypto.randomUUID()} />
        {options.back === null ? null : <input type="hidden" name="back" value={options.back} />}
        <TextField name="title" label="Title" scope={page.id} value={typed.title} maxLength={200} />
        <TextAreaField
          name="bodyMd"
          label="Text"
          scope={page.id}
          value={typed.bodyMd}
          rows={BODY_ROWS}
          maxLength={1_000_000}
          hint={page.type === 'skill' ? instructionsHint : markdownHint}
        />
        <p class="m-0 flex flex-wrap items-center gap-2">
          <button type="submit" class={primaryButton}>
            Save
          </button>
          <a href={withBack(pagePath(page.id), options.back)} class={commandButton}>
            Cancel
          </a>
        </p>
      </form>
    </Card>
  );
}

export async function renderPageEdit(
  c: Context<AppEnv>,
  screen: ScreenKernel,
  pageId: string,
  options: EditOptions,
): Promise<Response> {
  const shown = await shownPage(c, screen, pageId);
  if (shown === null) return notFound(c);
  const { page } = shown;
  const read = withBack(pagePath(page.id), options.back);
  return renderScreen(
    c,
    pageSpec(page, pageNames.pageEdit),
    <>
      <PageHead
        eyebrow={typeWords[page.type] ?? page.type}
        title={page.title}
        lede={`Editing version ${String(page.version)}. Readers see it as it was last saved.`}
      />
      <div class="flex flex-col gap-5">
        {options.refused === null ? null : <Note>{refusalText(options.refused)}</Note>}
        {shown.canEdit ? (
          <EditForm page={page} options={options} />
        ) : (
          <Card title="Read only">
            <p class="m-0 text-sm text-text-2">
              You can read this page. Editing it needs the editor role in area {page.jdArea}.
            </p>
            <p class="m-0">
              <a href={read} class={pageLink}>
                Back to the page
              </a>
            </p>
          </Card>
        )}
      </div>
    </>,
  );
}

export async function pageEditScreen(c: Context<AppEnv>): Promise<Response> {
  const screen = screenKernel(c);
  if (screen === null) return screenRefusal(c);
  const pageId = idParam(c.req.param('pageId'));
  if (pageId === null) return notFound(c);
  const read = await screen.kernel.views.page(screen.caller, { pageId }, { at: screen.at });
  if (read.status !== 'accepted') return notFound(c);
  const back = backOf(c.req.query('back'));
  return renderPageEdit(c, screen, pageId, { back, refused: null, typed: null });
}
