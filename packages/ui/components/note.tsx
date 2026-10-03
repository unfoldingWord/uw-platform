import type { Child } from 'hono/jsx';

export function Note(props: { readonly children: Child }) {
  return (
    <p
      role="note"
      class="m-0 rounded-md border-l-4 border-cultivate bg-bg px-3 py-2 text-sm text-ink"
    >
      {props.children}
    </p>
  );
}
