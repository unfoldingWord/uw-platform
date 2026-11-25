import type { Child } from 'hono/jsx';
import { domId } from './text.ts';

export function Tooltip(props: {
  readonly id: string;
  readonly text: string;
  readonly children: Child;
}) {
  const id = domId('tip', props.id);
  return (
    <span class="group/tip relative inline-flex" aria-describedby={id}>
      {props.children}
      <span
        id={id}
        role="tooltip"
        class="pointer-events-none invisible absolute bottom-full left-1/2 z-10 mb-1 w-max max-w-aside -translate-x-1/2 rounded-sm bg-text px-2 py-1 text-xs font-semibold text-surface opacity-0 transition-opacity motion-reveal group-focus-within/tip:visible group-focus-within/tip:opacity-100 group-hover/tip:visible group-hover/tip:opacity-100 group-hover/tip:delay-tooltip"
      >
        {props.text}
      </span>
    </span>
  );
}
