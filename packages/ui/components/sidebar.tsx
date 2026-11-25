import type { IconName } from '../generated/icons.ts';
import { AccountInitials, AccountRow, type Person } from './account-menu.tsx';
import { safeHref } from './href.ts';
import { PersonCount } from './human-action.tsx';
import { Icon } from './icon.tsx';

export type NavCount =
  | { readonly kind: 'quiet'; readonly text: string }
  | { readonly kind: 'person'; readonly count: number; readonly label: string }
  | { readonly kind: 'watch'; readonly text: string };

export type NavItem = {
  readonly label: string;
  readonly icon?: IconName;
  readonly href?: string;
  readonly count?: NavCount;
  readonly code?: string;
  readonly nested?: boolean;
  readonly depth?: 1 | 2 | 3;
  readonly open?: boolean;
};

export type NavSection = {
  readonly heading?: string;
  readonly code?: string;
  readonly empty?: string;
  readonly items: readonly NavItem[];
};

const focus = 'outline-offset-2 outline-side-code focus-visible:outline-2';
const row =
  'flex items-center gap-2 rounded-md px-2 py-1 text-base whitespace-nowrap no-underline transition-colors motion-reveal';
const unbuilt = 'cursor-default text-side-text-3';
const guides = { 1: 'ml-4', 2: 'ml-6', 3: 'ml-7' } as const;
const current = 'aria-[current=page]:bg-side-hover aria-[current=page]:font-semibold';

function Count(props: { readonly count: NavCount | undefined }) {
  const { count } = props;
  if (count === undefined) return null;
  if (count.kind === 'person') return <PersonCount count={count.count} label={count.label} />;
  const tone = count.kind === 'watch' ? 'text-side-code' : 'text-side-text-3';
  return <span class={`ml-auto font-mono text-xs ${tone}`}>{count.text}</span>;
}

function Mark(props: { readonly icon: IconName | undefined }) {
  if (props.icon === undefined) return null;
  return <Icon name={props.icon} size={2} />;
}

function TreeRow(props: {
  readonly item: NavItem;
  readonly depth: 1 | 2 | 3;
  readonly href: string;
  readonly current: string;
}) {
  const { item } = props;
  const weight = item.open === true ? 'font-semibold' : 'font-regular';
  return (
    <li class={`${guides[props.depth]} border-l border-side-line pl-1`}>
      <a
        href={props.href}
        aria-current={props.href === props.current ? 'page' : undefined}
        data-open={item.open === true ? '' : undefined}
        class={`group flex items-center gap-2 rounded-md px-2 py-1 text-sm ${weight} whitespace-nowrap text-side-text no-underline transition-colors motion-reveal hover:bg-side-hover ${current} ${focus}`}
      >
        {item.code === undefined ? null : (
          <span class="font-mono text-xs text-side-code">{item.code}</span>
        )}
        <span class="min-w-0 truncate">{item.label}</span>
        <Count count={item.count} />
      </a>
    </li>
  );
}

function NavRow(props: { readonly item: NavItem; readonly current: string }) {
  const { item } = props;
  const indent = item.nested === true ? 'pl-6' : '';
  const open = item.open === true ? 'bg-side-hover' : '';
  const href = item.href === undefined ? undefined : safeHref(item.href);
  if (href !== undefined && item.depth !== undefined) {
    return <TreeRow item={item} depth={item.depth} href={href} current={props.current} />;
  }
  if (href === undefined) {
    return (
      <li>
        <span aria-disabled="true" class={`${row} ${indent} ${unbuilt} text-side-text`}>
          <Mark icon={item.icon} />
          <span class="min-w-0 truncate">{item.label}</span>
        </span>
      </li>
    );
  }
  return (
    <li>
      <a
        href={href}
        aria-current={href === props.current ? 'page' : undefined}
        data-open={item.open === true ? '' : undefined}
        class={`group ${row} ${indent} ${open} text-side-text hover:bg-side-hover ${current} ${focus}`}
      >
        <Mark icon={item.icon} />
        <span class="min-w-0 truncate">{item.label}</span>
        <Count count={item.count} />
      </a>
    </li>
  );
}

function allUnbuilt(section: NavSection): boolean {
  return section.items.length > 0 && section.items.every((item) => item.href === undefined);
}

function Heading(props: { readonly section: NavSection }) {
  const { section } = props;
  if (section.heading === undefined) return null;
  return (
    <p
      data-area={section.code}
      class="flex items-baseline gap-2 px-2 pb-1 text-xs leading-snug font-semibold text-side-text-3"
    >
      {section.code === undefined ? null : (
        <span class="shrink-0 font-mono font-regular whitespace-nowrap text-side-text-3">
          {section.code}
        </span>
      )}
      <span class="min-w-0">{section.heading}</span>
    </p>
  );
}

function built(section: NavSection): NavSection {
  return { ...section, items: section.items.filter((item) => item.href !== undefined) };
}

function unbuiltItems(sections: readonly NavSection[]): readonly NavItem[] {
  return sections.flatMap((section) => section.items.filter((item) => item.href === undefined));
}

function More(props: { readonly items: readonly NavItem[] }) {
  if (props.items.length === 0) return null;
  return (
    <li>
      <details data-more="">
        <summary
          class={`${row} cursor-pointer list-none text-side-text-3 hover:bg-side-hover ${focus}`}
        >
          <Icon name="ellipsis" size={2} />
          <span>More</span>
        </summary>
        <ul class="flex flex-col">
          {props.items.map((item) => (
            <li>
              <span aria-disabled="true" data-unbuilt="true" class={`${row} pl-6 ${unbuilt}`}>
                <span class="min-w-0 truncate">{item.label}</span>
                <span class="ml-auto text-xs">Not built yet</span>
              </span>
            </li>
          ))}
        </ul>
      </details>
    </li>
  );
}

function Section(props: { readonly section: NavSection; readonly current: string }) {
  const { section } = props;
  if (allUnbuilt(section)) return null;
  const shown = built(section);
  return (
    <li>
      <Heading section={section} />
      <ul class="flex flex-col">
        {shown.items.map((item) => (
          <NavRow item={item} current={props.current} />
        ))}
      </ul>
      {section.empty === undefined ? null : (
        <p class="px-2 py-1 text-xs text-side-text-3 italic">{section.empty}</p>
      )}
    </li>
  );
}

export function NavList(props: {
  readonly sections: readonly NavSection[];
  readonly current: string;
}) {
  return (
    <ul class="flex flex-col gap-4">
      {props.sections.map((section) => (
        <Section section={section} current={props.current} />
      ))}
      <More items={unbuiltItems(props.sections)} />
    </ul>
  );
}

function Brand(props: { readonly wordmarkPath: string }) {
  return (
    <div class="flex items-center gap-2 px-4 pt-5 pb-4">
      <img src={props.wordmarkPath} alt="unfoldingWord" class="h-size-3 w-auto shrink-0" />
      <p class="border-l border-side-line pl-2 text-sm font-semibold text-side-text-3">Platform</p>
    </div>
  );
}

export function Sidebar(props: {
  readonly sections: readonly NavSection[];
  readonly current: string;
  readonly person: Person | null;
  readonly wordmarkPath: string;
}) {
  return (
    <aside data-side class="hidden min-h-0 flex-col bg-side text-side-text md:flex">
      <Brand wordmarkPath={props.wordmarkPath} />
      <nav aria-label="Main" class="flex-1 overflow-auto px-2 pb-4">
        <NavList sections={props.sections} current={props.current} />
      </nav>
      <div class="p-2">
        <AccountRow person={props.person} />
      </div>
    </aside>
  );
}

export function PhoneHeader(props: {
  readonly title: string;
  readonly waiting: number;
  readonly sections: readonly NavSection[];
  readonly current: string;
  readonly person: Person | null;
  readonly wordmarkPath: string;
}) {
  return (
    <section data-side aria-label="Menu" class="relative bg-side text-side-text md:hidden">
      <details>
        <summary class={`flex cursor-pointer list-none items-center gap-3 py-3 pr-8 pl-4 ${focus}`}>
          <span class="grid size-size-5 shrink-0 place-items-center rounded-md border border-side-line">
            <Icon name="bars" size={2} />
          </span>
          <span class="sr-only">Menu</span>
          <img src={props.wordmarkPath} alt="unfoldingWord" class="h-size-2 w-auto shrink-0" />
          <span class="min-w-0 truncate text-sm font-heavy">{props.title}</span>
          {props.waiting === 0 ? null : (
            <PersonCount count={props.waiting} label={`${props.waiting} waiting on you`} />
          )}
        </summary>
        <nav aria-label="Main" class="max-h-dvh overflow-auto border-t border-side-line p-2">
          <NavList sections={props.sections} current={props.current} />
        </nav>
      </details>
      <AccountInitials person={props.person} />
    </section>
  );
}
