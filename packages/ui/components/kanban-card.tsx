import type { Child } from 'hono/jsx';
import { safeHref } from './href.ts';

const titleLink =
  'text-link underline-offset-2 hover:underline outline-offset-2 outline-focus focus-visible:outline-2';

export function KanbanCard(props: {
  readonly title: string;
  readonly href: string;
  readonly meta: readonly { readonly label: string; readonly value: string }[];
  readonly actions?: Child;
}) {
  const href = safeHref(props.href);
  return (
    <article class="rounded-lg border border-line bg-surface p-3 text-ink">
      <h3 class="m-0 break-words text-sm font-bold">
        {href === undefined ? (
          props.title
        ) : (
          <a href={href} class={titleLink}>
            {props.title}
          </a>
        )}
      </h3>
      {props.meta.length === 0 ? null : (
        <dl class="m-0 mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          {props.meta.map((fact) => (
            <>
              <dt class="text-muted">{fact.label}</dt>
              <dd class="m-0 text-ink">{fact.value}</dd>
            </>
          ))}
        </dl>
      )}
      {props.actions === undefined ? null : (
        <div class="mt-3 flex flex-col gap-2">{props.actions}</div>
      )}
    </article>
  );
}
