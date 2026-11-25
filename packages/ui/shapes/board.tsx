import type { Child } from 'hono/jsx';
import { ShapeHead, type Head } from './head.tsx';

export function BoardShape(props: {
  readonly head: Head;
  readonly toolbar?: Child | undefined;
  readonly lanesLabel?: string | undefined;
  readonly children?: Child | undefined;
}) {
  return (
    <div data-shape="board" class="flex w-full min-w-0 flex-col gap-5">
      <ShapeHead head={props.head} />
      {props.toolbar === undefined ? null : (
        <div class="flex flex-wrap items-center gap-2">{props.toolbar}</div>
      )}
      {props.children}
    </div>
  );
}

export function Lanes(props: { readonly label: string; readonly children?: Child }) {
  return (
    <div
      role="region"
      aria-label={props.label}
      tabindex={0}
      class="flex min-w-0 items-start gap-3 overflow-x-auto pb-2 outline-offset-2 outline-accent-text focus-visible:outline-2"
    >
      {props.children}
    </div>
  );
}
