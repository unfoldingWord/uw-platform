const option =
  'flex cursor-pointer items-baseline gap-3 rounded-sm px-3 py-2 text-sm text-text aria-selected:bg-accent aria-selected:font-semibold aria-selected:text-on-accent';

function PagePickerMenu() {
  return (
    <>
      <ul
        data-editor-menu=""
        role="listbox"
        aria-label="Link to a page"
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
  readonly draft: DraftRoom | null;
  readonly styleNonce: string;
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
      data-style-nonce={props.styleNonce}
      {...room}
      hidden
      class="flex min-w-0 flex-col"
    >
      <div data-editor-surface="" class="min-h-aside min-w-0"></div>
      <PagePickerMenu />
    </div>
  );
}
