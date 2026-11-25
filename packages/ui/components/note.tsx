import type { Child } from 'hono/jsx';

export function Note(props: { readonly children: Child }) {
  return (
    <p role="note" class="m-0 rounded-md bg-accent-soft p-3 text-sm font-semibold text-accent-text">
      {props.children}
    </p>
  );
}
