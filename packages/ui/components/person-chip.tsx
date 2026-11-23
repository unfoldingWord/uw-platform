import { safeHref } from './href.ts';

export type PersonChipPerson = {
  readonly name: string;
  readonly href?: string | undefined;
};

const nameParts = /[\s._-]+/;

export function initialsOf(name: string): string {
  const letters = name
    .split(nameParts)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => [...part][0]?.toUpperCase() ?? '');
  return letters.join('') || '?';
}

const shape = 'inline-flex max-w-full min-w-0 items-center gap-2 align-middle';
const linked = `${shape} rounded-sm font-heavy text-accent-text outline-offset-2 outline-accent-text hover:underline focus-visible:outline-2`;
const plain = `${shape} font-heavy text-text`;
const avatar =
  'grid size-size-4 shrink-0 place-items-center rounded-full bg-accent-soft text-xs font-heavy text-accent-text';

function Avatar(props: { readonly name: string }) {
  return (
    <span aria-hidden="true" class={avatar}>
      {initialsOf(props.name)}
    </span>
  );
}

export function PersonChip(props: { readonly person: PersonChipPerson }) {
  const { name } = props.person;
  const href = props.person.href === undefined ? undefined : safeHref(props.person.href);
  const body = (
    <>
      <Avatar name={name} />
      <span class="min-w-0 truncate">{name}</span>
    </>
  );
  if (href === undefined) {
    return (
      <span data-person-chip="" class={plain}>
        {body}
      </span>
    );
  }
  return (
    <a data-person-chip="" href={href} class={linked}>
      {body}
    </a>
  );
}
