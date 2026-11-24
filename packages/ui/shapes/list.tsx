import type { Child } from 'hono/jsx';
import { ShapeHead, page, type Head } from './head.tsx';

export function ListShape(props: {
  readonly head: Head;
  readonly filters?: Child | undefined;
  readonly peek?: Child | undefined;
  readonly children?: Child | undefined;
}) {
  const body = (
    <div class="flex min-w-0 flex-col gap-5">
      {props.filters === undefined ? null : (
        <div class="flex flex-wrap items-center gap-2">{props.filters}</div>
      )}
      {props.children}
    </div>
  );
  return (
    <div data-shape="list" class={page}>
      <ShapeHead head={props.head} />
      {props.peek === undefined ? (
        body
      ) : (
        <div class="grid grid-cols-1 gap-6 lg:grid-cols-peek">
          {body}
          {props.peek}
        </div>
      )}
    </div>
  );
}
