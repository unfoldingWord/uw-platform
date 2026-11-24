import { safeHref } from './href.ts';
import { humanBadge } from './human-action.tsx';

export type TabLink = {
  readonly label: string;
  readonly href: string;
  readonly current: boolean;
  readonly count?: number | undefined;
};

const tab =
  'inline-flex items-center gap-2 border-b-2 border-transparent py-2 text-base font-semibold whitespace-nowrap text-text-3 no-underline outline-offset-2 outline-accent-text transition-colors motion-reveal hover:text-text focus-visible:outline-2 aria-[current=page]:border-accent aria-[current=page]:text-text';

export function Tabs(props: { readonly label?: string; readonly tabs: readonly TabLink[] }) {
  if (props.tabs.length === 0) return null;
  return (
    <nav
      aria-label={props.label ?? 'Views'}
      class="flex gap-5 overflow-x-auto border-b border-line-soft"
    >
      {props.tabs.map((entry) => {
        const href = safeHref(entry.href);
        if (href === undefined) return null;
        const count = entry.count ?? 0;
        return (
          <a
            href={href}
            aria-current={entry.current ? 'page' : undefined}
            aria-label={count > 0 ? `${entry.label}, ${count} waiting` : undefined}
            class={tab}
          >
            {entry.label}
            {count > 0 ? (
              <span
                data-count
                class={`rounded-sm px-1 font-mono text-xs leading-normal ${humanBadge}`}
              >
                {count}
              </span>
            ) : null}
          </a>
        );
      })}
    </nav>
  );
}
