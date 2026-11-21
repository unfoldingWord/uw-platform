import type { Context } from 'hono';
import type { Child } from 'hono/jsx';
import type { Page } from '@uw/contracts';
import { Card } from '@uw/ui/components/card.tsx';
import { Note } from '@uw/ui/components/note.tsx';
import { PageHead } from '@uw/ui/components/page-head.tsx';
import { reasonText } from '@uw/ui/components/text.ts';
import type { AppEnv } from '../../deps.ts';
import { editorPath } from '../../generated/editor.ts';
import { renderScreen, screenKernel, screenRefusal, type ScreenKernel } from '../parts/frame.tsx';
import { pageNames } from '../parts/names.ts';
import { editorCanShow } from '../../markdown/editor-html.ts';
import { draftsOf } from '../../pages/drafts.ts';
import { EditorFrame, uploadIdOf, type DraftRoom } from '../parts/editor-frame.tsx';
import { EditBar } from '../parts/edit-bar.tsx';
import { Icon } from '@uw/ui/components/icon.tsx';
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
const sheetEdge =
  'rounded-t-lg border border-b-0 border-line bg-surface px-4 pt-6 pb-8 shadow-2 md:px-8 md:pt-7';
const instructionsHint =
  'Agents at a stage using this page receive this text as their instructions.';
const markdownHint = 'Write in markdown.';

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

const fileLink =
  'inline-flex cursor-pointer items-center gap-2 rounded-md border border-line px-3 py-1 text-sm font-heavy text-text-2 outline-offset-2 outline-accent-text hover:border-accent hover:text-accent-text has-focus-visible:outline-2 group-data-editor-active/edit:hidden';

function UploadControl(props: { readonly pageId: string }) {
  const id = uploadIdOf(props.pageId);
  return (
    <div data-upload="" data-page={props.pageId} class="flex min-w-0 flex-col items-start gap-1">
      <label for={id} class={fileLink}>
        <Icon name="paperclip" size={1} />
        Add a picture or file
        <input id={id} type="file" data-upload-input="" class="sr-only" />
      </label>
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
  readonly read: string;
  readonly children?: Child;
};

const titleInput =
  'w-full rounded-sm border-0 bg-transparent p-0 text-xl leading-tight md:text-3xl font-heavy tracking-heading text-text outline-offset-4 outline-accent-text focus-visible:outline-2';

function TitleField(props: { readonly page: Page; readonly title: string }) {
  const id = `title-${props.page.id}`;
  return (
    <div>
      <label for={id} class="sr-only">
        Title
      </label>
      <input
        id={id}
        name="title"
        type="text"
        value={props.title}
        maxLength={200}
        required
        class={titleInput}
      />
    </div>
  );
}

const bodyInput =
  'min-h-aside w-full resize-y rounded-md border-0 bg-transparent p-0 font-mono text-sm leading-normal text-text outline-offset-4 outline-accent-text focus-visible:outline-2';

function BodyField(props: { readonly page: Page; readonly bodyMd: string }) {
  const id = `body-${props.page.id}`;
  return (
    <div data-editor-text="">
      <label for={id} class="sr-only">
        Text
      </label>
      <textarea id={id} name="bodyMd" rows={BODY_ROWS} maxLength={1_000_000} class={bodyInput}>
        {props.bodyMd}
      </textarea>
    </div>
  );
}

function hintOf(page: Page, asText: boolean): string {
  if (page.type === 'skill') return instructionsHint;
  const saved = `Readers see version ${String(page.version)} until you save.`;
  return asText
    ? `${saved} ${markdownHint}`
    : `${saved} Type / for blocks and [[ to link or embed a page.`;
}

function EditSheet(props: FormProps & { readonly typed: Typed }) {
  const { page, options, typed } = props;
  return (
    <div class={`${sheetEdge} flex flex-1 flex-col gap-4`}>
      <TitleField page={page} title={typed.title} />
      <p class="m-0 text-sm text-text-3">{hintOf(page, options.asText)}</p>
      {options.asText ? null : (
        <EditorFrame pageId={page.id} bodyMd={typed.bodyMd} draft={props.draft} />
      )}
      <BodyField page={page} bodyMd={typed.bodyMd} />
      <p
        data-editor-status=""
        role="status"
        aria-live="polite"
        class="m-0 text-sm text-text-3 empty:hidden"
      ></p>
      <UploadControl pageId={page.id} />
    </div>
  );
}

function EditForm(props: FormProps) {
  const { page, options } = props;
  const typed = options.typed ?? {
    title: page.title,
    bodyMd: page.bodyMd,
    expectedVersion: page.version,
  };
  return (
    <form
      method="post"
      action={pageEditPath(page.id)}
      data-page-edit=""
      class="group/edit flex min-h-dvh flex-col"
    >
      <input type="hidden" name="expectedVersion" value={String(typed.expectedVersion)} />
      <input type="hidden" name="requestId" value={crypto.randomUUID()} />
      {options.back === null ? null : <input type="hidden" name="back" value={options.back} />}
      <EditBar page={page} read={props.read} drafting={props.draft !== null} />
      <div class="flex flex-1 justify-center px-4 pt-6 md:px-5">
        <div class="flex w-full max-w-flow flex-col gap-4">
          {props.children}
          <EditSheet
            page={page}
            options={options}
            draft={props.draft}
            read={props.read}
            typed={typed}
          />
        </div>
      </div>
    </form>
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

function EditNotes(props: { readonly options: EditOptions }) {
  const { options } = props;
  return (
    <>
      {options.refused === null ? null : <Note>{refusalText(options.refused)}</Note>}
      {options.asText && !options.askedForText ? (
        <Note>This page uses formatting the editor cannot keep, so it opens as text.</Note>
      ) : null}
      {options.asText ? (
        <Note>Text you type here is kept only until you leave. Save before going back.</Note>
      ) : null}
    </>
  );
}

function Editable(props: {
  readonly page: Page;
  readonly editing: Editing;
  readonly read: string;
}) {
  const { options, draft } = props.editing;
  return (
    <>
      <EditForm page={props.page} options={options} draft={draft} read={props.read}>
        <EditNotes options={options} />
      </EditForm>
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

function readOnlyScreen(c: Context<AppEnv>, shown: ShownPage, options: EditOptions, read: string) {
  const { page } = shown;
  return renderScreen(
    c,
    pageSpec(shown, pageNames.pageEdit),
    <>
      <PageHead eyebrow={typeWords[page.type] ?? page.type} title={page.title} />
      <div class="flex flex-col gap-5">
        {options.refused === null ? null : <Note>{refusalText(options.refused)}</Note>}
        <ReadOnly page={page} read={read} />
      </div>
    </>,
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
  if (!shown.canEdit) return readOnlyScreen(c, shown, options, read);
  return renderScreen(
    c,
    { ...pageSpec(shown, pageNames.pageEdit), focus: true },
    <Editable page={page} editing={editingOf(c, shown, screen, options)} read={read} />,
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
