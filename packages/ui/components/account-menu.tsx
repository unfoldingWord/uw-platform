import { safeHref } from './href.ts';
import { Icon } from './icon.tsx';

export type Person = {
  readonly initials: string;
  readonly name: string;
  readonly email: string;
  readonly role: string;
};

export type LogOutLink = { readonly label: string; readonly href: string };

export const accountMenuId = 'account-menu';

const focus = 'outline-offset-2 outline-side-code focus-visible:outline-2';
const opens = 'Account menu';

function Initials(props: { readonly person: Person | null; readonly size: 'row' | 'bar' }) {
  const box = props.size === 'bar' ? 'size-size-5' : 'size-size-4';
  if (props.person === null) {
    return (
      <span
        aria-hidden="true"
        class={`grid ${box} shrink-0 place-items-center rounded-full border border-side-line`}
      >
        <Icon name="user" size={2} />
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      class={`grid ${box} shrink-0 place-items-center rounded-full bg-ok text-xs font-heavy text-on-accent`}
    >
      {props.person.initials}
    </span>
  );
}

export function AccountRow(props: { readonly person: Person | null }) {
  const { person } = props;
  return (
    <button
      type="button"
      popovertarget={accountMenuId}
      class={`flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1 text-left hover:bg-side-hover ${focus}`}
    >
      <Initials person={person} size="row" />
      {person === null ? null : (
        <span class="min-w-0 leading-snug">
          <span class="block truncate text-sm font-heavy">{person.name}</span>
          <span class="block truncate text-xs text-side-text-3">{person.role}</span>
        </span>
      )}
      <span class="sr-only">{opens}</span>
    </button>
  );
}

export function AccountInitials(props: { readonly person: Person | null }) {
  const { person } = props;
  return (
    <button
      type="button"
      popovertarget={accountMenuId}
      class={`absolute top-3 right-4 cursor-pointer rounded-full ${focus}`}
    >
      <Initials person={person} size="bar" />
      <span class="sr-only">{person === null ? opens : `${opens}, ${person.name}`}</span>
    </button>
  );
}

function LogOut(props: { readonly link: LogOutLink }) {
  const href = safeHref(props.link.href);
  if (href === undefined) return null;
  return (
    <a
      href={href}
      class={`flex items-center gap-2 rounded-sm px-2 py-1 text-sm font-semibold whitespace-nowrap text-side-text hover:bg-side-hover ${focus}`}
    >
      <Icon name="right-from-bracket" size={2} />
      <span>{props.link.label}</span>
    </a>
  );
}

function Who(props: { readonly person: Person }) {
  const { person } = props;
  return (
    <div class="mb-2 border-b border-side-line px-2 pb-2 leading-snug">
      <p class="truncate text-sm font-heavy">{person.name}</p>
      <p class="truncate text-xs text-side-text-3">{person.email}</p>
      <p class="truncate text-xs text-side-text-3">{person.role}</p>
    </div>
  );
}

export function AccountMenu(props: {
  readonly person: Person | null;
  readonly logOut: LogOutLink;
}) {
  return (
    <div
      id={accountMenuId}
      popover="auto"
      aria-label="Account"
      class="absolute inset-auto top-8 right-2 m-0 w-side max-w-full rounded-md border border-side-line bg-side p-2 text-side-text shadow-2 md:fixed md:top-auto md:right-auto md:bottom-8 md:left-2"
    >
      {props.person === null ? null : <Who person={props.person} />}
      <LogOut link={props.logOut} />
    </div>
  );
}
