import type { Child } from 'hono/jsx';
import { Icon } from './icon.tsx';

const summary =
  'flex cursor-pointer list-none items-center gap-2 rounded-md px-1 py-1 text-text outline-offset-2 outline-accent-text hover:bg-raised focus-visible:outline-2';

export function Disclosure(props: {
  readonly summary: Child;
  readonly open?: boolean | undefined;
  readonly attrs?: Readonly<Record<string, string | undefined>> | undefined;
  readonly children?: Child | undefined;
}) {
  return (
    <details open={props.open !== false} class="group/disclosure min-w-0" {...(props.attrs ?? {})}>
      <summary class={summary}>
        <Icon
          name="chevron-down"
          size={2}
          class="shrink-0 text-text-3 -rotate-90 transition-transform motion-reveal group-open/disclosure:rotate-0"
        />
        <span class="min-w-0 flex-1 text-base font-semibold">{props.summary}</span>
      </summary>
      <div class="flex min-w-0 flex-col gap-2 pt-2 pb-1 pl-7">{props.children}</div>
    </details>
  );
}
