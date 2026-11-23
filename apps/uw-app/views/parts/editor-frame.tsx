import { raw } from 'hono/html';
import { IconToggle } from '@uw/ui/components/chip.tsx';
import { Icon, type IconProps } from '@uw/ui/components/icon.tsx';
import { editorHtml } from '../../markdown/editor-html.ts';

type Tool = {
  readonly format: string;
  readonly label: string;
  readonly icon: IconProps['name'];
};

const groups: readonly (readonly Tool[])[] = [
  [
    { format: 'bold', label: 'Bold', icon: 'bold' },
    { format: 'italic', label: 'Italic', icon: 'italic' },
    { format: 'strike', label: 'Strikethrough', icon: 'strikethrough' },
    { format: 'highlight', label: 'Highlight', icon: 'highlighter' },
    { format: 'code', label: 'Code', icon: 'code' },
  ],
  [
    { format: 'heading2', label: 'Heading', icon: 'heading' },
    { format: 'bullets', label: 'Bulleted list', icon: 'list-ul' },
    { format: 'numbers', label: 'Numbered list', icon: 'list-ol' },
    { format: 'checklist', label: 'Checklist', icon: 'list-check' },
  ],
  [
    { format: 'quote', label: 'Quote', icon: 'quote-left' },
    { format: 'callout', label: 'Callout', icon: 'lightbulb' },
    { format: 'details', label: 'Collapsible section', icon: 'square-caret-down' },
    { format: 'table', label: 'Table', icon: 'table' },
    { format: 'codeBlock', label: 'Code block', icon: 'file-code' },
    { format: 'rule', label: 'Divider', icon: 'minus' },
  ],
  [
    { format: 'undo', label: 'Undo', icon: 'rotate-left' },
    { format: 'redo', label: 'Redo', icon: 'rotate-right' },
  ],
];

const option =
  'flex cursor-pointer items-baseline gap-3 rounded-sm px-3 py-2 text-sm text-text aria-selected:bg-accent aria-selected:font-heavy aria-selected:text-on-accent';

const fileButton =
  'inline-flex size-size-5 cursor-pointer items-center justify-center rounded-full text-side-text outline-offset-2 outline-side-code hover:bg-side-hover has-focus-visible:outline-2';

function Toolbar(props: { readonly uploadFor: string }) {
  return (
    <div
      data-editor-toolbar=""
      role="toolbar"
      aria-label="Formatting"
      class="fixed inset-x-4 bottom-5 z-20 mx-auto flex w-fit flex-wrap items-center justify-center gap-1 rounded-full bg-side p-1 shadow-3"
    >
      {groups.map((group, index) => (
        <span
          class={`flex items-center gap-1 ${index === 0 ? '' : 'border-l border-side-line pl-1'}`}
        >
          {group.map((entry) => (
            <IconToggle format={entry.format} label={entry.label} icon={entry.icon} tone="side" />
          ))}
        </span>
      ))}
      <span class="flex items-center border-l border-side-line pl-1">
        <label for={props.uploadFor} title="Add a picture or file" class={fileButton}>
          <Icon name="paperclip" size={1} />
          <span class="sr-only">Add a picture or file</span>
        </label>
      </span>
    </div>
  );
}

function InsertMenu() {
  return (
    <>
      <ul
        data-editor-menu=""
        role="listbox"
        aria-label="Insert"
        hidden
        class="fixed z-50 m-0 flex max-h-aside w-aside list-none flex-col overflow-y-auto rounded-md border border-line bg-surface p-1 shadow-3"
      ></ul>
      <template data-editor-menu-row="">
        <li role="option" aria-selected="false" class={option}>
          <span data-title="" class="min-w-0 truncate"></span>
          <span data-meta="" class="ml-auto shrink-0 text-xs opacity-70"></span>
        </li>
      </template>
    </>
  );
}

export function uploadIdOf(pageId: string): string {
  return `upload-${pageId}`;
}

export type DraftRoom = { readonly version: number; readonly person: string };

type FrameProps = {
  readonly pageId: string;
  readonly bodyMd: string;
  readonly draft: DraftRoom | null;
  readonly videos?: ReadonlySet<string>;
};

const noVideos: ReadonlySet<string> = new Set();

export function EditorFrame(props: FrameProps) {
  const videos = props.videos ?? noVideos;
  const listed = [...videos].map((id) => `/api/files/${id}`).join(' ');
  const room =
    props.draft === null
      ? {}
      : { 'data-draft-version': String(props.draft.version), 'data-person': props.draft.person };
  return (
    <div
      data-editor=""
      data-page={props.pageId}
      {...room}
      data-video-files={listed === '' ? undefined : listed}
      hidden
      class="flex min-w-0 flex-col gap-4"
    >
      <div
        data-editor-surface=""
        data-page-body=""
        class="min-h-aside rounded-md outline-offset-4 outline-accent-text has-focus-visible:outline-2"
      ></div>
      <Toolbar uploadFor={uploadIdOf(props.pageId)} />
      <template data-editor-content="">
        {raw(editorHtml(props.bodyMd, (id) => (videos.has(id) ? 'video' : null)))}
      </template>
      <InsertMenu />
    </div>
  );
}
