import type { Context } from 'hono';
import type { Page } from '@uw/contracts';
import { Card } from '@uw/ui/components/card.tsx';
import { commandButton, primaryButton } from '@uw/ui/components/command-form.tsx';
import { TextAreaField, TextField } from '@uw/ui/components/field.tsx';
import { Note } from '@uw/ui/components/note.tsx';
import { PageHead } from '@uw/ui/components/page-head.tsx';
import { reasonText } from '@uw/ui/components/text.ts';
import type { AppEnv } from '../../deps.ts';
import { editorPath } from '../../generated/editor.ts';
import { renderScreen, screenKernel, screenRefusal, type ScreenKernel } from '../parts/frame.tsx';
import { pageNames } from '../parts/names.ts';
import { editorCanShow } from '../../markdown/editor-html.ts';
import { draftsOf } from '../../pages/drafts.ts';
import { EditorFrame, type DraftRoom } from '../parts/editor-frame.tsx';
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
  readonly asText: boolean;
  readonly askedForText?: boolean;
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

function UploadControl(props: { readonly pageId: string }) {
  const id = `upload-${props.pageId}`;
  return (
    <div data-upload="" data-page={props.pageId} class="flex min-w-0 flex-col gap-1">
      <label for={id} class="text-xs font-heavy tracking-wide text-text-3 uppercase">
        Add a picture or file
      </label>
      <input
        id={id}
        type="file"
        data-upload-input=""
        class="rounded-md text-sm text-text outline-offset-2 outline-accent-text focus-visible:outline-2"
      />
      <p data-upload-status="" role="status" aria-live="polite" class="m-0 text-xs text-text-3">
        Pictures, PDFs and office files up to 20 MB. It is added where your cursor is.
      </p>
    </div>
  );
}

type FormProps = {
  readonly page: Page;
  readonly options: EditOptions;
  readonly draft: DraftRoom | null;
};

function EditForm(props: FormProps) {
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
        {options.asText ? null : (
          <EditorFrame pageId={page.id} bodyMd={typed.bodyMd} draft={props.draft} />
        )}
        <div data-editor-text="">
          <TextAreaField
            name="bodyMd"
            label="Text"
            scope={page.id}
            value={typed.bodyMd}
            rows={BODY_ROWS}
            maxLength={1_000_000}
            hint={page.type === 'skill' ? instructionsHint : markdownHint}
          />
        </div>
        <p
          data-editor-status=""
          role="status"
          aria-live="polite"
          class="m-0 text-sm text-text-3"
        ></p>
        <UploadControl pageId={page.id} />
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

function ReadOnly(props: { readonly page: Page; readonly read: string }) {
  return (
    <Card title="Read only">
      <p class="m-0 text-sm text-text-2">
        You can read this page. Editing it needs the editor role in area {props.page.jdArea}.
      </p>
      <p class="m-0">
        <a href={props.read} class={pageLink}>
          Back to the page
        </a>
      </p>
    </Card>
  );
}

type Editing = { readonly options: EditOptions; readonly draft: DraftRoom | null };

function Editable(props: { readonly page: Page; readonly editing: Editing }) {
  const { options, draft } = props.editing;
  return (
    <>
      {options.asText && !options.askedForText ? (
        <Note>This page uses formatting the editor cannot keep, so it opens as text.</Note>
      ) : null}
      <EditForm page={props.page} options={options} draft={draft} />
      {options.asText ? null : <script type="module" src={editorPath}></script>}
    </>
  );
}

function editingOf(
  c: Context<AppEnv>,
  shown: ShownPage,
  screen: ScreenKernel,
  options: EditOptions,
): Editing {
  const { page } = shown;
  const asText = options.asText || !editorCanShow(page.bodyMd);
  const together = draftsOf(c.env) !== null && options.typed === null && !asText;
  const draft = together
    ? { version: page.version, person: screen.caller.actor.email ?? '' }
    : null;
  return { options: { ...options, asText, askedForText: options.asText }, draft };
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
    pageSpec(shown, pageNames.pageEdit),
    <>
      <PageHead
        eyebrow={typeWords[page.type] ?? page.type}
        title={page.title}
        lede={`Editing version ${String(page.version)}. Readers see it as it was last saved.`}
      />
      <div class="flex flex-col gap-5">
        {options.refused === null ? null : <Note>{refusalText(options.refused)}</Note>}
        {shown.canEdit ? (
          <Editable page={page} editing={editingOf(c, shown, screen, options)} />
        ) : (
          <ReadOnly page={page} read={read} />
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
  const asText = c.req.query('as') === 'text';
  return renderPageEdit(c, screen, pageId, { asText, back, refused: null, typed: null });
}
