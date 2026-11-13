import type { Child } from 'hono/jsx';

export function Note(props: { readonly children: Child }) {
  return (
    <p
      role="note"
      class="m-0 rounded-md border border-line bg-accent-soft px-3 py-2 text-sm font-semibold text-accent-text"
    >
      {props.children}
    </p>
  );
}
