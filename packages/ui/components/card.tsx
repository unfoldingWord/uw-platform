import type { Child } from 'hono/jsx';

export function Card(props: { readonly title?: string; readonly children?: Child }) {
  return (
    <section class="rounded-lg border border-line bg-surface p-4 text-ink">
      {props.title === undefined ? null : (
        <h2 class="mb-3 text-lg font-bold text-ink">{props.title}</h2>
      )}
      {props.children}
    </section>
  );
}
