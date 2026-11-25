import { Button } from '@uw/ui/components/button.tsx';
import { railLink } from '@uw/ui/components/rail-list.tsx';

export function JdSuggest() {
  return (
    <div data-jd-suggest="" class="mt-2 flex min-w-0 flex-col gap-2">
      <p
        data-jd-status=""
        role="status"
        aria-live="polite"
        class="m-0 text-sm text-text-2 empty:hidden"
      ></p>
      <p class="m-0">
        <Button variant="secondary" size="sm" attrs={{ 'data-jd-use': '', hidden: true }}>
          Use the next free number
        </Button>
      </p>
      <ul
        data-jd-matches=""
        aria-label="Pages with a matching number or title"
        hidden
        class="m-0 flex list-none flex-col gap-1 p-0"
      ></ul>
      <template data-jd-row="">
        <li>
          <a class={railLink}>
            <span data-number="" class="font-mono text-xs text-text-3"></span>{' '}
            <span data-title=""></span>
          </a>
        </li>
      </template>
    </div>
  );
}
