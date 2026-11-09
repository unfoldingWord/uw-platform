import type { IconName } from '../generated/icons.ts';
import { safeHref } from './href.ts';
import { PersonCount } from './human-action.tsx';
import { Icon } from './icon.tsx';

export type NavCount =
  | { readonly kind: 'quiet'; readonly text: string }
  | { readonly kind: 'person'; readonly count: number; readonly label: string }
  | { readonly kind: 'watch'; readonly text: string };

export type NavMark = { readonly icon: IconName } | { readonly initial: string };

export type NavItem = {
  readonly label: string;
  readonly mark: NavMark;
  readonly href?: string;
  readonly count?: NavCount;
  readonly unwired?: string;
};

export type NavSection = {
  readonly heading?: string;
  readonly aside?: string;
  readonly items: readonly NavItem[];
};

export type Person = { readonly initials: string; readonly name: string; readonly role: string };

const focus = 'outline-offset-2 outline-accent-text focus-visible:outline-2';
const row = 'flex h-size-6 items-center gap-3 rounded-md px-2 text-sm font-semibold';

const quietCount = 'ml-auto font-mono text-xs font-regular text-text-3';
const watchCount = 'ml-auto font-mono text-xs font-regular text-accent-text';

function Mark(props: { readonly mark: NavMark }) {
  const { mark } = props;
  if ('icon' in mark) return <Icon name={mark.icon} size={2} class="text-text-3" />;
  return (
    <span
      aria-hidden="true"
      class="grid size-size-3 shrink-0 place-items-center rounded-sm bg-accent text-xs font-heavy text-on-accent"
    >
      {mark.initial}
    </span>
  );
}

function Count(props: { readonly count: NavCount | undefined }) {
  const { count } = props;
  if (count === undefined) return null;
  if (count.kind === 'person') return <PersonCount count={count.count} label={count.label} />;
  return <span class={count.kind === 'watch' ? watchCount : quietCount}>{count.text}</span>;
}

function NavRow(props: { readonly item: NavItem; readonly current: string }) {
  const { item } = props;
  const href = item.href === undefined ? undefined : safeHref(item.href);
  if (href === undefined) {
    return (
      <li>
        <span aria-disabled="true" class={`${row} text-text-3`}>
          <Mark mark={item.mark} />
          <span>{item.label}</span>
          <span class="ml-auto text-xs font-regular">{item.unwired ?? 'Not wired yet'}</span>
        </span>
      </li>
    );
  }
  const current = href === props.current;
  return (
    <li>
      <a
        href={href}
        aria-current={current ? 'page' : undefined}
        class={`${row} text-text-2 hover:bg-hover hover:text-text aria-[current=page]:bg-raised aria-[current=page]:text-text aria-[current=page]:shadow-1 ${focus}`}
      >
        <Mark mark={item.mark} />
        <span class="min-w-0 truncate">{item.label}</span>
        <Count count={item.count} />
      </a>
    </li>
  );
}

function Section(props: { readonly section: NavSection; readonly current: string }) {
  const { section } = props;
  return (
    <li>
      {section.heading === undefined ? null : (
        <p class="flex items-center gap-2 px-2 pt-4 pb-1 text-xs font-semibold text-text-3">
          <span>{section.heading}</span>
          {section.aside === undefined ? null : (
            <span class="ml-auto font-mono font-regular">{section.aside}</span>
          )}
        </p>
      )}
      <ul class="flex flex-col gap-1">
        {section.items.map((item) => (
          <NavRow item={item} current={props.current} />
        ))}
      </ul>
    </li>
  );
}

export function NavList(props: {
  readonly sections: readonly NavSection[];
  readonly current: string;
}) {
  return (
    <ul class="flex flex-col gap-1">
      {props.sections.map((section) => (
        <Section section={section} current={props.current} />
      ))}
    </ul>
  );
}

export function Brand(props: { readonly markPath: string }) {
  return (
    <div class="flex items-center gap-3 px-3 pt-4 pb-3">
      <img src={props.markPath} alt="" class="h-size-5 w-auto shrink-0" />
      <div>
        <p class="text-md leading-tight font-heavy text-text">unfoldingWord</p>
        <p class="text-xs text-text-3">Platform</p>
      </div>
    </div>
  );
}

function Search() {
  return (
    <div
      aria-disabled="true"
      class="mx-3 mb-2 flex h-size-5 items-center gap-2 rounded-md bg-raised px-2 text-sm text-text-3 shadow-1"
    >
      <Icon name="magnifying-glass" size={1} />
      <span class="min-w-0 truncate">Search or jump to…</span>
      <span class="ml-auto shrink-0 text-xs whitespace-nowrap">Not wired yet</span>
    </div>
  );
}

function Me(props: { readonly person: Person }) {
  const { person } = props;
  return (
    <div class="flex items-center gap-3 border-t border-line p-3">
      <span
        aria-hidden="true"
        class="grid size-size-6 shrink-0 place-items-center rounded-full bg-accent text-sm font-heavy text-on-accent"
      >
        {person.initials}
      </span>
      <div class="min-w-0">
        <p class="truncate text-base font-semibold text-text">{person.name}</p>
        <p class="truncate text-xs text-text-3">{person.role}</p>
      </div>
    </div>
  );
}

export function Sidebar(props: {
  readonly sections: readonly NavSection[];
  readonly current: string;
  readonly person: Person | null;
  readonly markPath: string;
}) {
  return (
    <aside class="hidden min-h-0 flex-col border-r border-line bg-side md:flex">
      <Brand markPath={props.markPath} />
      <Search />
      <nav aria-label="Main" class="flex-1 overflow-auto px-2 py-1">
        <NavList sections={props.sections} current={props.current} />
      </nav>
      {props.person === null ? null : <Me person={props.person} />}
    </aside>
  );
}

export function PhoneHeader(props: {
  readonly title: string;
  readonly waiting: number;
  readonly sections: readonly NavSection[];
  readonly current: string;
  readonly markPath: string;
}) {
  return (
    <section aria-label="Menu" class="border-b border-line bg-side md:hidden">
      <div class="flex h-size-7 items-center gap-3 px-3">
        <img src={props.markPath} alt="unfoldingWord" class="h-size-4 w-auto shrink-0" />
        <p class="min-w-0 truncate text-md font-heavy text-text">{props.title}</p>
        {props.waiting === 0 ? null : (
          <PersonCount count={props.waiting} label={`${props.waiting} waiting on you`} />
        )}
      </div>
      <details class="px-3 pb-2">
        <summary
          class={`cursor-pointer rounded-md py-1 text-sm font-semibold text-text-2 ${focus}`}
        >
          Menu
        </summary>
        <nav aria-label="Main" class="pt-2">
          <NavList sections={props.sections} current={props.current} />
        </nav>
      </details>
    </section>
  );
}
