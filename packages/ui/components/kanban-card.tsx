import type { Child } from 'hono/jsx';
import type { IconName } from '../generated/icons.ts';
import { safeHref } from './href.ts';
import { Icon } from './icon.tsx';

const titleLink =
  'text-text underline-offset-2 hover:underline outline-offset-2 outline-accent-text focus-visible:outline-2';
const summary =
  'cursor-pointer text-xs text-text-3 outline-offset-2 outline-accent-text focus-visible:outline-2';

export type CardFact = { readonly label: string; readonly value: string };
export type CardFoot = { readonly icon: IconName; readonly text: string };

function Facts(props: { readonly meta: readonly CardFact[] }) {
  if (props.meta.length === 0) return null;
  return (
    <details>
      <summary class={summary}>Details</summary>
      <dl class="m-0 mt-2 grid grid-cols-label gap-x-3 gap-y-1 text-xs">
        {props.meta.map((fact) => (
          <>
            <dt class="text-text-3">{fact.label}</dt>
            <dd class="m-0 text-text">{fact.value}</dd>
          </>
        ))}
      </dl>
    </details>
  );
}

function Top(props: {
  readonly number?: string | undefined;
  readonly risk?: string | undefined;
  readonly badge?: Child | undefined;
}) {
  if (props.number === undefined && props.risk === undefined && props.badge === undefined)
    return null;
  return (
    <div class="flex items-center gap-2 text-xs text-text-3">
      {props.number === undefined ? null : <span class="font-mono">{props.number}</span>}
      {props.risk === undefined ? null : (
        <span class="flex min-w-0 items-center gap-1">
          <span aria-hidden="true" class="size-size-1 shrink-0 rounded-full bg-accent"></span>
          <span class="truncate">{props.risk}</span>
        </span>
      )}
      {props.badge === undefined ? null : <span class="ml-auto">{props.badge}</span>}
    </div>
  );
}

function Foot(props: { readonly foot: readonly CardFoot[] }) {
  if (props.foot.length === 0) return null;
  return (
    <ul class="m-0 flex list-none flex-wrap gap-x-3 gap-y-1 p-0 text-xs text-text-3">
      {props.foot.map((entry) => (
        <li class="flex items-center gap-1">
          <Icon name={entry.icon} size={1} />
          {entry.text}
        </li>
      ))}
    </ul>
  );
}

export function KanbanCard(props: {
  readonly title: string;
  readonly href: string;
  readonly meta: readonly CardFact[];
  readonly number?: string | undefined;
  readonly risk?: string | undefined;
  readonly badge?: Child | undefined;
  readonly last?: string | undefined;
  readonly status?: Child | undefined;
  readonly foot?: readonly CardFoot[] | undefined;
  readonly actions?: Child | undefined;
}) {
  const href = safeHref(props.href);
  return (
    <article class="flex flex-col gap-1 rounded-md border border-line bg-card px-3 py-2 text-text hover:border-accent">
      <Top number={props.number} risk={props.risk} badge={props.badge} />
      <h3 class="m-0 text-base leading-snug font-heavy break-words">
        {href === undefined ? (
          props.title
        ) : (
          <a href={href} class={titleLink}>
            {props.title}
          </a>
        )}
      </h3>
      {props.last === undefined ? null : <p class="m-0 text-xs text-text-3">{props.last}</p>}
      {props.status}
      <Foot foot={props.foot ?? []} />
      {props.actions === undefined ? null : (
        <div class="mt-1 flex flex-col gap-2">{props.actions}</div>
      )}
      <Facts meta={props.meta} />
    </article>
  );
}
