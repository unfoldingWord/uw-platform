import type { Context } from 'hono';
import type { Child } from 'hono/jsx';
import type { Page } from '@uw/contracts';
import { buttonClass } from '@uw/ui/components/button.tsx';
import { Note } from '@uw/ui/components/note.tsx';
import { Section } from '@uw/ui/components/section.tsx';
import { DocumentShape } from '@uw/ui/shapes/document.tsx';
import { reasonText } from '@uw/ui/components/text.ts';
import type { AppEnv } from '../../deps.ts';
import { editorCssPath, editorPath } from '../../generated/editor.ts';
import { renderScreen, screenKernel, screenRefusal, type ScreenKernel } from '../parts/frame.tsx';
import { pageNames } from '../parts/names.ts';
import { styleNonceFor } from '../../http/security-headers.ts';
import { draftsOf } from '../../pages/drafts.ts';
import { EditorFrame, uploadIdOf, type DraftRoom } from '../parts/editor-frame.tsx';
import { EditBar } from '../parts/edit-bar.tsx';
import { Icon } from '@uw/ui/components/icon.tsx';
import {
  backOf,
  markOf,
  pageLink,
  pageScreenSpec,
  pageSpec,
  shownPage,
  type ShownPage,
} from '../parts/page-shown.ts';
import { BodyField, EditorStatus, TitleField } from '../parts/page-fields.tsx';
import { JdSuggest, categoryOfPage, jdRefusalText, numberedAttrs } from '../parts/jd-suggest.tsx';
import { Properties } from '../parts/page-read.tsx';
import { pageFacts } from '../parts/page-status.tsx';
import { idParam } from '../parts/params.ts';
import { pageEditPath, pagePath, withBack } from '../parts/paths.ts';
import { notFound } from './not-found.tsx';

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
  readonly back: string | null;
  readonly refused: string | null;
  readonly typed: Typed | null;
};

function refusalText(reason: string, title: string): string {
  const numbering = jdRefusalText(reason, title);
  if (numbering !== null) return `Not saved: ${numbering}`;
  if (reason === 'stale_version') {
    return 'Someone saved a newer version. Your text is kept below; copy what you need, then reload to edit the newest version.';
  }
  return `Not saved: ${reasonText(reason)}.`;
}

const uploadLabel = `${buttonClass('ghost', 'sm')} has-focus-visible:outline-2 group-data-editor-active/edit:hidden`;

function UploadControl(props: { readonly pageId: string }) {
  const id = uploadIdOf(props.pageId);
  return (
    <div
      data-upload=""
      data-page={props.pageId}
      class="sticky bottom-4 z-10 flex max-w-full min-w-0 flex-wrap items-center gap-2 self-start rounded-full bg-surface px-2 py-1 shadow-3"
    >
      <label for={id} class={uploadLabel}>
        <Icon name="paperclip" size={1} />
        Add a picture or file
        <input id={id} type="file" data-upload-input="" class="sr-only" />
      </label>
      <p
        data-upload-status=""
        role="status"
        aria-live="polite"
        class="m-0 px-1 text-xs text-text-3"
      >
        Pictures, PDFs and office files up to 20 MB. It is added where your cursor is.
      </p>
    </div>
  );
}

type FormProps = {
  readonly page: Page;
  readonly options: EditOptions;
  readonly draft: DraftRoom | null;
  readonly styleNonce: string;
  readonly read: string;
  readonly children?: Child;
};

function hintOf(page: Page, asText: boolean): string {
  if (page.type === 'skill') return instructionsHint;
  const saved = `Readers see version ${String(page.version)} until you save.`;
  return asText
    ? `${saved} ${markdownHint}`
    : `${saved} Type / for blocks and [[ to link or embed a page.`;
}

function EditRail(props: { readonly page: Page; readonly asText: boolean }) {
  return (
    <>
      <Properties facts={pageFacts(props.page)} />
      <p class="m-0 text-sm text-text-3">{hintOf(props.page, props.asText)}</p>
    </>
  );
}

function EditBody(props: FormProps & { readonly typed: Typed }) {
  const { page, options, typed } = props;
  return (
    <>
      {props.children}
      <div class="flex min-w-0 flex-col gap-4">
        {options.asText ? null : (
          <EditorFrame pageId={page.id} draft={props.draft} styleNonce={props.styleNonce} />
        )}
        <BodyField pageId={page.id} bodyMd={typed.bodyMd} />
        <EditorStatus />
      </div>
      <UploadControl pageId={page.id} />
    </>
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
      data-unsaved={options.typed === null ? undefined : ''}
      class="group/edit"
      {...numberedAttrs(categoryOfPage(page), page.id)}
    >
      <input type="hidden" name="expectedVersion" value={String(typed.expectedVersion)} />
      <input type="hidden" name="requestId" value={crypto.randomUUID()} />
      {options.back === null ? null : <input type="hidden" name="back" value={options.back} />}
      <DocumentShape
        band={<EditBar read={props.read} drafting={props.draft !== null} />}
        head={{
          eyebrow: markOf(page),
          title: page.title,
          titleField: (
            <>
              <TitleField pageId={page.id} title={typed.title} />
              {categoryOfPage(page) === null ? null : <JdSuggest />}
            </>
          ),
        }}
        rail={<EditRail page={page} asText={options.asText} />}
      >
        <EditBody {...props} typed={typed} />
      </DocumentShape>
    </form>
  );
}

function ReadOnly(props: { readonly page: Page; readonly read: string }) {
  return (
    <Section title="Read only">
      <p class="m-0 text-sm text-text-2">
        You can read this page. Editing it needs the editor role in area {props.page.jdArea}.
      </p>
      <p class="m-0">
        <a href={props.read} class={pageLink}>
          Back to the page
        </a>
      </p>
    </Section>
  );
}

type Editing = {
  readonly options: EditOptions;
  readonly draft: DraftRoom | null;
  readonly styleNonce: string;
};

function EditNotes(props: { readonly options: EditOptions; readonly page: Page }) {
  const { options, page } = props;
  const title = options.typed?.title ?? page.title;
  return (
    <>
      {options.refused === null ? null : <Note>{refusalText(options.refused, title)}</Note>}
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
      <EditForm
        page={props.page}
        options={options}
        draft={draft}
        styleNonce={props.editing.styleNonce}
        read={props.read}
      >
        <EditNotes options={options} page={props.page} />
      </EditForm>
      {options.asText ? null : (
        <>
          <link rel="stylesheet" href={editorCssPath} />
          <script type="module" src={editorPath}></script>
        </>
      )}
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
  const together = draftsOf(c.env) !== null && options.typed === null && !options.asText;
  const draft = together
    ? { version: page.version, person: screen.caller.actor.email ?? '' }
    : null;
  return { options, draft, styleNonce: options.asText ? '' : styleNonceFor(c) };
}

function readOnlyScreen(c: Context<AppEnv>, shown: ShownPage, options: EditOptions, read: string) {
  const { page } = shown;
  return renderScreen(
    c,
    pageSpec(shown, pageNames.pageEdit),
    <DocumentShape head={{ eyebrow: markOf(page), title: page.title }}>
      {options.refused === null ? null : <Note>{refusalText(options.refused, page.title)}</Note>}
      <ReadOnly page={page} read={read} />
    </DocumentShape>,
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
    await pageScreenSpec(c, screen, shown, pageNames.pageEdit),
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
