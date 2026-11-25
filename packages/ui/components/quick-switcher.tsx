import { Icon } from './icon.tsx';

export const switcherId = 'quick-switcher';
const inputId = 'quick-switcher-input';
const listId = 'quick-switcher-list';

const option =
  'flex cursor-pointer items-baseline gap-3 rounded-sm px-3 py-2 text-base text-text aria-selected:bg-accent-soft aria-selected:font-semibold aria-selected:text-accent-text';

export function QuickSwitcherButton() {
  return (
    <button
      type="button"
      data-open-switcher=""
      aria-haspopup="dialog"
      aria-controls={switcherId}
      title="Jump to a page"
      class="inline-flex h-size-5 cursor-pointer items-center gap-2 rounded-md border border-transparent px-2 text-sm font-semibold text-text-2 outline-offset-2 outline-accent-text transition-colors motion-reveal hover:bg-hover hover:text-text focus-visible:outline-2"
    >
      <Icon name="file-lines" size={2} />
      <span class="sr-only">Jump to a page</span>
    </button>
  );
}

function SwitcherInput() {
  return (
    <>
      <label for={inputId} class="sr-only">
        Page name or JD ID
      </label>
      <input
        id={inputId}
        data-switcher-input=""
        type="text"
        role="combobox"
        aria-expanded="true"
        aria-controls={listId}
        aria-autocomplete="list"
        autocomplete="off"
        spellcheck={false}
        placeholder="Page name or JD ID"
        class="rounded-md border border-line bg-raised px-3 py-2 text-md text-text outline-offset-2 outline-accent-text focus-visible:outline-2"
      />
    </>
  );
}

export function QuickSwitcher() {
  return (
    <dialog
      id={switcherId}
      data-switcher=""
      aria-label="Jump to a page"
      class="m-auto mt-8 w-full max-w-content rounded-lg border-0 bg-surface p-0 text-text shadow-3 backdrop:bg-side/60"
    >
      <div class="flex flex-col gap-2 p-3">
        <SwitcherInput />
        <p
          data-switcher-status=""
          role="status"
          aria-live="polite"
          class="m-0 px-3 text-xs font-semibold text-text-3 empty:hidden"
        ></p>
        <ul
          id={listId}
          data-switcher-list=""
          role="listbox"
          aria-label="Pages"
          class="m-0 flex max-h-aside list-none flex-col overflow-y-auto p-0"
        ></ul>
        <p class="m-0 border-t border-line px-3 pt-2 text-xs text-text-3">
          Arrow keys to move, Enter to open, Ctrl or Cmd with Enter for a new tab, Esc to close.
        </p>
      </div>
      <template data-switcher-row="">
        <li role="option" aria-selected="false" class={option}>
          <span data-title="" class="min-w-0 truncate"></span>
          <span data-meta="" class="ml-auto shrink-0 font-mono text-xs opacity-70"></span>
        </li>
      </template>
    </dialog>
  );
}
