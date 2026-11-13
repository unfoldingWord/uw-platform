import type { Child } from 'hono/jsx';

export function Card(props: {
  readonly title?: string;
  readonly sub?: Child | undefined;
  readonly actions?: Child | undefined;
  readonly flush?: boolean | undefined;
  readonly children?: Child;
}) {
  const body = props.flush === true ? 'overflow-x-auto' : 'flex flex-col gap-3 p-4';
  return (
    <section class="flex min-w-0 flex-col rounded-md border border-line bg-surface text-text">
      {props.title === undefined ? null : (
        <div class="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          <h2 class="m-0 text-md font-heavy text-text">{props.title}</h2>
          {props.sub === undefined ? null : (
            <span class="text-xs font-semibold text-text-3">{props.sub}</span>
          )}
          {props.actions === undefined ? null : (
            <span class="ml-auto flex items-center gap-2">{props.actions}</span>
          )}
        </div>
      )}
      <div class={body}>{props.children}</div>
    </section>
  );
}
