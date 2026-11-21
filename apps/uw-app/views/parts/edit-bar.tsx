import type { Page } from '@uw/contracts';
import { knowledgeFrontmatterSchema } from '@uw/contracts';
import { HumanSubmit } from '@uw/ui/components/human-action.tsx';
import { Icon } from '@uw/ui/components/icon.tsx';

const onSide = 'outline-offset-2 outline-side-code focus-visible:outline-2';

const sideButton = `inline-flex cursor-pointer items-center gap-2 rounded-md border border-side-line px-3 py-1 text-sm font-heavy text-side-text hover:bg-side-hover ${onSide}`;

function jdIdOf(page: Page): string | null {
  const filed = knowledgeFrontmatterSchema.safeParse(page.frontmatter);
  return page.type === 'knowledge' && filed.success ? filed.data.jd_id : null;
}

export function EditBar(props: { readonly page: Page; readonly read: string }) {
  const jdId = jdIdOf(props.page);
  return (
    <div
      data-edit-bar=""
      class="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 bg-side px-4 py-2 text-side-text md:px-5"
    >
      <nav aria-label="Page">
        <a
          href={props.read}
          data-leave-edit=""
          class={`inline-flex items-center gap-2 rounded-sm text-sm font-heavy text-side-text ${onSide}`}
        >
          <Icon name="chevron-left" size={1} />
          Back to reading
          <kbd class="hidden rounded-sm border border-side-line px-1 font-mono text-xs text-side-text-3 md:inline">
            Esc
          </kbd>
        </a>
      </nav>
      <p class="m-0 flex min-w-0 items-center gap-2 text-sm">
        {jdId === null ? null : <span class="font-mono text-side-code">{jdId}</span>}
        <span class="truncate font-heavy">{props.page.title}</span>
      </p>
      <div class="flex flex-wrap items-center gap-2">
        <p
          data-editor-people=""
          role="status"
          aria-live="polite"
          class="m-0 text-xs font-heavy text-side-text-3 empty:hidden"
        ></p>
        <button type="button" data-editor-discard="" hidden class={sideButton}>
          Discard draft
        </button>
        <HumanSubmit label="Save" icon="check" />
      </div>
    </div>
  );
}
