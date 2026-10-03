import { ThemeSwitch } from './theme-switch.tsx';

export type Crumb = { readonly label: string; readonly href?: string };

const link =
  'text-link underline-offset-2 hover:underline outline-offset-2 outline-focus focus-visible:outline-2';

function CrumbItem(props: { readonly crumb: Crumb; readonly last: boolean }) {
  const { crumb, last } = props;
  return (
    <li class="flex items-center gap-2">
      {crumb.href === undefined ? (
        <span aria-current={last ? 'page' : undefined}>{crumb.label}</span>
      ) : (
        <a href={crumb.href} class={link}>
          {crumb.label}
        </a>
      )}
      {last ? null : <span aria-hidden="true">/</span>}
    </li>
  );
}

export function TopBar(props: { readonly crumbs: readonly Crumb[] }) {
  return (
    <header class="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-surface px-4 py-2 md:px-6">
      <nav aria-label="Breadcrumb" class="min-w-0 text-sm text-muted">
        <ol class="flex flex-wrap items-center gap-2">
          {props.crumbs.map((crumb, index) => (
            <CrumbItem crumb={crumb} last={index === props.crumbs.length - 1} />
          ))}
        </ol>
      </nav>
      <ThemeSwitch />
    </header>
  );
}
