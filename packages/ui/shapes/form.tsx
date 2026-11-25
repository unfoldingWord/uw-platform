import type { Child } from 'hono/jsx';
import { ShapeHead, type Head } from './head.tsx';

export function FormShape(props: { readonly head: Head; readonly children?: Child }) {
  return (
    <div data-shape="form" class="mx-auto flex w-full max-w-flow min-w-0 flex-col gap-6">
      <ShapeHead head={props.head} />
      <div class="flex min-w-0 flex-col gap-5">{props.children}</div>
    </div>
  );
}

export function FormActions(props: { readonly children?: Child }) {
  return <div class="flex flex-wrap items-center justify-end gap-2">{props.children}</div>;
}
