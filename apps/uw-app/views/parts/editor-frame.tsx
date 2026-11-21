import { raw } from 'hono/html';
import { IconToggle } from '@uw/ui/components/chip.tsx';
import type { IconProps } from '@uw/ui/components/icon.tsx';
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

function Toolbar() {
  return (
    <div
      data-editor-toolbar=""
      role="toolbar"
      aria-label="Formatting"
      class="sticky bottom-4 z-10 flex flex-wrap items-center justify-center gap-1 self-center rounded-full border border-line bg-surface p-1 shadow-3"
    >
      {groups.map((group, index) => (
        <span class={`flex items-center gap-1 ${index === 0 ? '' : 'border-l border-line pl-1'}`}>
          {group.map((entry) => (
            <IconToggle format={entry.format} label={entry.label} icon={entry.icon} />
          ))}
        </span>
      ))}
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

export type DraftRoom = { readonly version: number; readonly person: string };

type FrameProps = {
  readonly pageId: string;
  readonly bodyMd: string;
  readonly draft: DraftRoom | null;
};

export function EditorFrame(props: FrameProps) {
  const room =
    props.draft === null
      ? {}
      : { 'data-draft-version': String(props.draft.version), 'data-person': props.draft.person };
  return (
    <div
      data-editor=""
      data-page={props.pageId}
      {...room}
      hidden
      class="flex min-w-0 flex-col gap-4"
    >
      <div
        data-editor-surface=""
        data-page-body=""
        class="min-h-aside rounded-md outline-offset-4 outline-accent-text has-focus-visible:outline-2"
      ></div>
      <Toolbar />
      <template data-editor-content="">{raw(editorHtml(props.bodyMd))}</template>
      <InsertMenu />
    </div>
  );
}
