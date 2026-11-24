import type { Child } from 'hono/jsx';
import { safeHref } from './href.ts';
import { Icon } from './icon.tsx';
import { QuickSwitcherButton } from './quick-switcher.tsx';
import { StatusDot, type Status } from './status-bar.tsx';
import type { TabLink } from './tabs.tsx';

export type Crumb = { readonly label: string; readonly href?: string };
export type Tab = TabLink;

const focus = 'outline-offset-2 outline-accent-text focus-visible:outline-2';

function CrumbItem(props: { readonly crumb: Crumb; readonly last: boolean }) {
  const { crumb, last } = props;
  const href = crumb.href === undefined ? undefined : safeHref(crumb.href);
  const label = last ? (
    <span aria-current="page" class="font-semibold text-text">
      {crumb.label}
    </span>
  ) : href === undefined ? (
    <span>{crumb.label}</span>
  ) : (
    <a href={href} class={`text-text-3 no-underline hover:text-accent-text ${focus}`}>
      {crumb.label}
    </a>
  );
  return (
    <li class="flex items-center gap-2">
      {label}
      {last ? null : (
        <span aria-hidden="true" class="text-line-strong">
          /
        </span>
      )}
    </li>
  );
}

const searchId = 'top-bar-search';

function Search() {
  return (
    <form
      action="/search"
      method="get"
      role="search"
      class="hidden h-size-5 w-aside items-center gap-2 rounded-md bg-raised px-3 text-sm text-text-3 lg:flex"
    >
      <Icon name="magnifying-glass" size={1} />
      <label for={searchId} class="sr-only">
        Search pages
      </label>
      <input
        id={searchId}
        type="search"
        name="q"
        maxlength={200}
        placeholder="Search pages"
        class="min-w-0 flex-1 rounded-sm bg-transparent text-sm text-text outline-offset-2 outline-accent-text placeholder:text-text-3 focus-visible:outline-2"
      />
    </form>
  );
}

export function Crumbs(props: {
  readonly code?: string | undefined;
  readonly crumbs: readonly Crumb[];
}) {
  return (
    <nav aria-label="Breadcrumb" class="min-w-0 text-sm text-text-3">
      <ol class="flex flex-wrap items-center gap-2">
        {props.code === undefined ? null : (
          <li class="rounded-sm bg-accent-soft px-1 font-mono text-xs text-accent-text">
            {props.code}
          </li>
        )}
        {props.crumbs.map((crumb, index) => (
          <CrumbItem crumb={crumb} last={index === props.crumbs.length - 1} />
        ))}
      </ol>
    </nav>
  );
}

export function TopBar(props: {
  readonly code?: string | undefined;
  readonly crumbs: readonly Crumb[];
  readonly actions?: Child | undefined;
  readonly status: Status;
}) {
  return (
    <header
      data-chrome=""
      class="flex min-h-size-8 flex-wrap items-center gap-3 border-b border-line-soft bg-surface px-5 py-2 md:px-6"
    >
      <Crumbs code={props.code} crumbs={props.crumbs} />
      <div class="ml-auto flex flex-wrap items-center gap-2">
        {props.actions}
        <StatusDot status={props.status} />
        <QuickSwitcherButton />
        <Search />
      </div>
    </header>
  );
}
