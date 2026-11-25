import type { Child } from 'hono/jsx';
import { safeHref } from './href.ts';

const revealed =
  'flex shrink-0 items-center gap-1 opacity-0 transition-opacity motion-reveal group-focus-within/row:opacity-100 group-hover/row:opacity-100 has-open:opacity-100 pointer-coarse:opacity-100';

const link =
  'text-base font-semibold text-text no-underline outline-offset-2 outline-accent-text after:absolute after:inset-0 after:rounded-md hover:text-text focus-visible:outline-2';

export function RowList(props: { readonly label: string; readonly children?: Child }) {
  return (
    <ul aria-label={props.label} class="-mx-3 m-0 flex list-none flex-col p-0">
      {props.children}
    </ul>
  );
}

export function ListRow(props: {
  readonly title: Child;
  readonly href?: string | undefined;
  readonly lead?: Child | undefined;
  readonly meta?: Child | undefined;
  readonly trail?: Child | undefined;
  readonly actions?: Child | undefined;
  readonly selected?: boolean | undefined;
  readonly attrs?: Readonly<Record<string, string | undefined>> | undefined;
  readonly linkAttrs?: Readonly<Record<string, string | undefined>> | undefined;
}) {
  const href = props.href === undefined ? undefined : safeHref(props.href);
  const tint =
    props.selected === true ? 'bg-accent-soft' : 'hover:bg-raised focus-within:bg-raised';
  return (
    <li
      aria-current={props.selected === true ? 'true' : undefined}
      class={`group/row relative flex min-w-0 items-center gap-3 rounded-md px-3 py-2 transition-colors motion-reveal ${tint}`}
      {...(props.attrs ?? {})}
    >
      {props.lead}
      <div class="min-w-0 flex-1">
        {href === undefined ? (
          <p class="m-0 text-base font-semibold text-text">{props.title}</p>
        ) : (
          <a href={href} class={link} {...(props.linkAttrs ?? {})}>
            {props.title}
          </a>
        )}
        {props.meta === undefined ? null : (
          <p class="m-0 text-sm text-text-3 [&_a]:relative">{props.meta}</p>
        )}
      </div>
      {props.trail === undefined ? null : (
        <div class="relative flex shrink-0 items-center gap-2">{props.trail}</div>
      )}
      {props.actions === undefined ? null : (
        <div class={`relative ${revealed}`}>{props.actions}</div>
      )}
    </li>
  );
}

export function Avatar(props: { readonly initials: string; readonly agent?: boolean }) {
  const tone = props.agent === true ? 'bg-ok-soft text-ok-text' : 'bg-accent-soft text-accent-text';
  return (
    <span
      aria-hidden="true"
      class={`grid size-size-5 shrink-0 place-items-center rounded-full text-xs font-heavy ${tone}`}
    >
      {props.initials}
    </span>
  );
}
