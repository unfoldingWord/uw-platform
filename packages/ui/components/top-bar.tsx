import type { Child } from 'hono/jsx';
import type { IconName } from '../generated/icons.ts';
import { safeHref } from './href.ts';
import { Icon } from './icon.tsx';
import { ThemeSwitch } from './theme-switch.tsx';

export type Crumb = { readonly label: string; readonly href?: string };
export type Tab = {
  readonly label: string;
  readonly href: string;
  readonly icon: IconName;
  readonly current: boolean;
};

const focus = 'outline-offset-2 outline-accent-text focus-visible:outline-2';
const link = `text-accent-text underline-offset-2 hover:underline ${focus}`;

function CrumbItem(props: { readonly crumb: Crumb; readonly last: boolean }) {
  const { crumb, last } = props;
  const href = crumb.href === undefined ? undefined : safeHref(crumb.href);
  return (
    <li class="flex items-center gap-2">
      {href === undefined ? (
        <span aria-current={last ? 'page' : undefined} class={last ? 'text-text' : undefined}>
          {crumb.label}
        </span>
      ) : (
        <a href={href} class={link}>
          {crumb.label}
        </a>
      )}
      {last ? null : <span aria-hidden="true">/</span>}
    </li>
  );
}

function TabLink(props: { readonly tab: Tab }) {
  const { tab } = props;
  const href = safeHref(tab.href);
  if (href === undefined) return null;
  return (
    <a
      href={href}
      aria-current={tab.current ? 'page' : undefined}
      class={`flex h-size-5 items-center gap-2 rounded-full px-3 text-sm font-semibold text-text-3 hover:text-text aria-[current=page]:bg-hover aria-[current=page]:text-text ${focus}`}
    >
      <Icon name={tab.icon} size={1} />
      {tab.label}
    </a>
  );
}

export function TopBar(props: {
  readonly crumbs: readonly Crumb[];
  readonly tabs?: readonly Tab[] | undefined;
  readonly actions?: Child | undefined;
}) {
  const tabs = props.tabs ?? [];
  return (
    <header class="flex min-h-size-7 flex-wrap items-center gap-3 border-b border-line px-4 py-2">
      <nav aria-label="Breadcrumb" class="min-w-0 text-sm font-semibold text-text-2">
        <ol class="flex flex-wrap items-center gap-2">
          {props.crumbs.map((crumb, index) => (
            <CrumbItem crumb={crumb} last={index === props.crumbs.length - 1} />
          ))}
        </ol>
      </nav>
      {tabs.length === 0 ? null : (
        <nav aria-label="Views" class="flex gap-1 md:ml-3">
          {tabs.map((tab) => (
            <TabLink tab={tab} />
          ))}
        </nav>
      )}
      <div class="ml-auto flex items-center gap-2">
        {props.actions}
        <ThemeSwitch />
      </div>
    </header>
  );
}
