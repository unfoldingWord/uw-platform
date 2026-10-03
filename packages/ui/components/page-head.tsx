import type { Child } from 'hono/jsx';

export function PageHead(props: {
  readonly title: string;
  readonly eyebrow?: string;
  readonly lede?: string;
  readonly actions?: Child;
}) {
  return (
    <div class="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div class="min-w-0">
        {props.eyebrow === undefined ? null : (
          <p class="text-xs font-bold uppercase text-ocean">{props.eyebrow}</p>
        )}
        <h1 class="text-2xl font-extrabold text-ink">{props.title}</h1>
        {props.lede === undefined ? null : <p class="mt-1 text-muted">{props.lede}</p>}
      </div>
      {props.actions === undefined ? null : <div class="flex gap-2">{props.actions}</div>}
    </div>
  );
}
