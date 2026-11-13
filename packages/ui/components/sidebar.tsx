import type { IconName } from '../generated/icons.ts';
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
};

export type NavSection = {
  readonly heading?: string;
  readonly code?: string;
  readonly empty?: string;
  readonly items: readonly NavItem[];
};

export type Person = { readonly initials: string; readonly name: string; readonly role: string };

const focus = 'outline-offset-2 outline-side-code focus-visible:outline-2';
const row = 'flex items-center gap-2 rounded-sm px-2 py-1 text-sm font-semibold whitespace-nowrap';
const unbuilt = 'cursor-default opacity-45';

function Count(props: { readonly count: NavCount | undefined }) {
  const { count } = props;
  if (count === undefined) return null;
  if (count.kind === 'person') return <PersonCount count={count.count} label={count.label} />;
  const tone = count.kind === 'watch' ? 'text-side-code' : 'text-side-text-3';
  return (
    <span class={`ml-auto font-mono text-xs ${tone} group-aria-[current=page]:text-on-accent`}>
      {count.text}
    </span>
  );
}

function Code(props: { readonly code: string | undefined; readonly alone: boolean }) {
  if (props.code === undefined) return null;
  return (
    <span
      class={`${props.alone ? 'ml-auto ' : ''}font-mono text-xs text-side-text-3 group-aria-[current=page]:text-on-accent`}
    >
      {props.code}
    </span>
  );
}

function Mark(props: { readonly icon: IconName | undefined }) {
  if (props.icon === undefined) return null;
  return <Icon name={props.icon} size={2} />;
}

function NavRow(props: { readonly item: NavItem; readonly current: string }) {
  const { item } = props;
  const indent = item.nested === true ? 'pl-6' : '';
  const href = item.href === undefined ? undefined : safeHref(item.href);
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
        class={`group ${row} ${indent} text-side-text hover:bg-side-hover aria-[current=page]:bg-accent aria-[current=page]:font-heavy aria-[current=page]:text-on-accent ${focus}`}
      >
        <Mark icon={item.icon} />
        <span class="min-w-0 truncate">{item.label}</span>
        <Count count={item.count} />
        <Code code={item.code} alone={item.count === undefined} />
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
  const dim = allUnbuilt(section) ? 'opacity-60' : '';
  return (
    <p
      data-area={section.code}
      data-unbuilt={allUnbuilt(section) ? 'true' : undefined}
      class={`flex gap-1 px-2 pt-3 pb-1 text-xs leading-snug font-heavy tracking-wide text-side-text-3 uppercase ${dim}`}
    >
      {section.code === undefined ? null : (
        <span class="font-mono font-regular text-side-code">{section.code}</span>
      )}
      <span>{section.heading}</span>
    </p>
  );
}

function Section(props: { readonly section: NavSection; readonly current: string }) {
  const { section } = props;
  return (
    <li>
      <Heading section={section} />
      <ul class="flex flex-col">
        {section.items.map((item) => (
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
    <ul class="flex flex-col">
      {props.sections.map((section) => (
        <Section section={section} current={props.current} />
      ))}
    </ul>
  );
}

function Brand(props: { readonly wordmarkPath: string }) {
  return (
    <div class="flex items-center gap-2 border-b border-side-line p-4">
      <img src={props.wordmarkPath} alt="unfoldingWord" class="h-size-3 w-auto shrink-0" />
      <p class="border-l border-side-line pl-2 text-sm font-heavy">Platform</p>
    </div>
  );
}

function Me(props: { readonly person: Person }) {
  const { person } = props;
  return (
    <div class="flex items-center gap-2 border-t border-side-line px-4 py-3">
      <span
        aria-hidden="true"
        class="grid size-size-4 shrink-0 place-items-center rounded-full bg-ok text-xs font-heavy text-on-accent"
      >
        {person.initials}
      </span>
      <div class="min-w-0 leading-snug">
        <p class="truncate text-sm font-heavy">{person.name}</p>
        <p class="truncate text-xs text-side-text-3">{person.role}</p>
      </div>
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
    <aside class="hidden min-h-0 flex-col bg-side text-side-text md:flex">
      <Brand wordmarkPath={props.wordmarkPath} />
      <nav aria-label="Main" class="flex-1 overflow-auto px-1 py-2">
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
  readonly wordmarkPath: string;
}) {
  return (
    <section aria-label="Menu" class="bg-side text-side-text md:hidden">
      <details>
        <summary class={`flex cursor-pointer list-none items-center gap-3 px-4 py-3 ${focus}`}>
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
    </section>
  );
}
