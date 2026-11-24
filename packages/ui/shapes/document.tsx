import type { Child } from 'hono/jsx';
import { ShapeHead, type Head } from './head.tsx';

export function DocumentShape(props: {
  readonly head: Head;
  readonly band?: Child | undefined;
  readonly rail?: Child | undefined;
  readonly railLabel?: string | undefined;
  readonly railOnPhone?: boolean | undefined;
  readonly children?: Child | undefined;
}) {
  const reading = 'flex min-w-0 max-w-flow flex-col gap-7';
  return (
    <div data-shape="document" class="mx-auto flex w-full max-w-content min-w-0 flex-col gap-6">
      {props.band}
      <ShapeHead head={props.head} document />
      {props.rail === undefined ? (
        <div class={reading}>{props.children}</div>
      ) : (
        <div class="grid grid-cols-1 gap-7 lg:grid-cols-document">
          <div class={reading}>{props.children}</div>
          <aside
            aria-label={props.railLabel ?? 'Properties'}
            class={`order-first min-w-0 flex-col gap-5 text-sm lg:order-none lg:flex lg:border-l lg:border-line-soft lg:pl-5 ${props.railOnPhone === false ? 'hidden' : 'flex'}`}
          >
            {props.rail}
          </aside>
        </div>
      )}
    </div>
  );
}
