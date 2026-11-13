import type { Child } from 'hono/jsx';

export function PageHead(props: {
  readonly title: string;
  readonly eyebrow?: string | undefined;
  readonly lede?: string | undefined;
  readonly actions?: Child | undefined;
  readonly flush?: boolean | undefined;
}) {
  return (
    <div
      class={`flex flex-wrap items-end justify-between gap-4 ${props.flush === true ? '' : 'mb-5'}`}
    >
      <div class="min-w-0">
        {props.eyebrow === undefined ? null : (
          <p class="m-0 mb-1 text-xs font-heavy tracking-wide text-accent-text uppercase">
            {props.eyebrow}
          </p>
        )}
        <h1 class="m-0 text-xl leading-tight font-heavy tracking-tight text-balance text-text">
          {props.title}
        </h1>
        {props.lede === undefined ? null : (
          <p class="m-0 mt-2 max-w-content text-base text-text-3">{props.lede}</p>
        )}
      </div>
      {props.actions === undefined ? null : (
        <div class="flex flex-wrap items-center gap-2">{props.actions}</div>
      )}
    </div>
  );
}
