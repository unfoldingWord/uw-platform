import type { Child } from 'hono/jsx';
import { Icon } from './icon.tsx';
import { revealed } from './list-row.tsx';

const summary =
  '-ml-2 flex cursor-pointer list-none items-center gap-2 rounded-md px-2 py-1 text-text outline-offset-2 outline-accent-text hover:bg-raised focus-visible:outline-2';

const actionsAt = 'absolute top-0 right-0 bg-surface pl-2';

export function Disclosure(props: {
  readonly summary: Child;
  readonly open?: boolean | undefined;
  readonly actions?: Child | undefined;
  readonly attrs?: Readonly<Record<string, string | undefined>> | undefined;
  readonly children?: Child | undefined;
}) {
  return (
    <div class="group/row relative min-w-0">
      <details
        open={props.open !== false}
        class="group/disclosure min-w-0"
        {...(props.attrs ?? {})}
      >
        <summary class={props.actions === undefined ? summary : `${summary} pointer-coarse:pr-7`}>
          <Icon
            name="chevron-down"
            size={2}
            class="shrink-0 -rotate-90 text-text-3 transition-transform motion-reveal group-open/disclosure:rotate-0"
          />
          <span class="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">{props.summary}</span>
        </summary>
        <div class="flex min-w-0 flex-col gap-2 pt-2 pb-1 pl-5">{props.children}</div>
      </details>
      {props.actions === undefined ? null : (
        <div data-disclosure-actions="" class={`${actionsAt} ${revealed}`}>
          {props.actions}
        </div>
      )}
    </div>
  );
}
