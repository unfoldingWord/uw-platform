import type { Child } from 'hono/jsx';
import { IconButton } from './button.tsx';
import { domId } from './text.ts';

export function SidePanel(props: {
  readonly id: string;
  readonly title: string;
  readonly reference?: string | undefined;
  readonly closeHref: string;
  readonly openHref?: string | undefined;
  readonly actions?: Child | undefined;
  readonly children?: Child | undefined;
}) {
  const headingId = domId('peek', props.id);
  return (
    <aside
      aria-labelledby={headingId}
      data-peek={props.id}
      class="flex min-w-0 flex-col gap-4 rounded-lg bg-surface p-5 shadow-3 lg:sticky lg:top-0 lg:self-start"
    >
      <div class="flex items-center gap-2">
        {props.reference === undefined ? null : (
          <span class="font-mono text-xs text-text-3">{props.reference}</span>
        )}
        <span class="flex-1"></span>
        {props.openHref === undefined ? null : (
          <IconButton
            icon="arrow-up-right-from-square"
            label="Open full page"
            href={props.openHref}
          />
        )}
        <IconButton icon="xmark" label="Close panel" href={props.closeHref} />
      </div>
      <h2 id={headingId} class="m-0 text-lg leading-snug font-heavy tracking-tight text-text">
        {props.title}
      </h2>
      {props.children}
      {props.actions === undefined ? null : (
        <div class="flex flex-wrap items-center gap-2">{props.actions}</div>
      )}
    </aside>
  );
}
