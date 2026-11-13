import type { Child } from 'hono/jsx';
import { safeHref } from './href.ts';
import { Icon } from './icon.tsx';
import { ThemeSwitch } from './theme-switch.tsx';

export type Crumb = { readonly label: string; readonly href?: string };
export type Tab = { readonly label: string; readonly href: string; readonly current: boolean };

const focus = 'outline-offset-2 outline-accent-text focus-visible:outline-2';

function CrumbItem(props: { readonly crumb: Crumb; readonly last: boolean }) {
  const { crumb, last } = props;
  const href = crumb.href === undefined ? undefined : safeHref(crumb.href);
  const label = last ? (
    <span aria-current="page" class="text-md font-heavy text-text">
      {crumb.label}
    </span>
  ) : href === undefined ? (
    <span>{crumb.label}</span>
  ) : (
    <a href={href} class={`hover:text-accent-text hover:underline ${focus}`}>
      {crumb.label}
    </a>
  );
  return (
    <li class="flex items-center gap-2">
      {label}
      {last ? null : <span aria-hidden="true">/</span>}
    </li>
  );
}

function Tabs(props: { readonly tabs: readonly Tab[] }) {
  if (props.tabs.length === 0) return null;
  return (
    <nav
      aria-label="Views"
      class="inline-flex overflow-hidden rounded-md border border-line bg-surface"
    >
      {props.tabs.map((tab) => {
        const href = safeHref(tab.href);
        if (href === undefined) return null;
        return (
          <a
            href={href}
            aria-current={tab.current ? 'page' : undefined}
            class={`border-r border-line px-3 py-1 text-sm font-heavy text-text-3 last:border-r-0 hover:text-text aria-[current=page]:bg-side aria-[current=page]:text-side-text ${focus}`}
          >
            {tab.label}
          </a>
        );
      })}
    </nav>
  );
}

function Search() {
  return (
    <div
      aria-disabled="true"
      class="hidden h-size-5 w-aside cursor-default items-center gap-2 rounded-md border border-line bg-canvas px-3 text-sm text-text-3 opacity-45 lg:flex"
    >
      <Icon name="magnifying-glass" size={1} />
      <span class="min-w-0 truncate">Search everything</span>
    </div>
  );
}

export function TopBar(props: {
  readonly code?: string | undefined;
  readonly crumbs: readonly Crumb[];
  readonly tabs?: readonly Tab[] | undefined;
  readonly actions?: Child | undefined;
}) {
  return (
    <header class="flex flex-wrap items-center gap-3 border-b border-line bg-surface px-4 py-3 md:px-5">
      <nav aria-label="Breadcrumb" class="min-w-0 text-sm font-semibold text-text-3">
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
      <Tabs tabs={props.tabs ?? []} />
      <div class="ml-auto flex flex-wrap items-center gap-2">
        <Search />
        {props.actions}
        <ThemeSwitch />
      </div>
    </header>
  );
}
