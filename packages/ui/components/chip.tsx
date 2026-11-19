import { safeHref } from './href.ts';

const base =
  'inline-flex h-size-4 items-center rounded-full border px-2 text-xs font-heavy whitespace-nowrap outline-offset-2 outline-accent-text focus-visible:outline-2';

function look(selected: boolean): string {
  return selected
    ? `${base} border-accent bg-accent-soft text-accent-text`
    : `${base} border-line bg-surface text-text-3 hover:border-accent hover:text-accent-text`;
}

export function Chip(props: {
  readonly label: string;
  readonly selected?: boolean;
  readonly href?: string;
}) {
  const selected = props.selected === true;
  const href = props.href === undefined ? undefined : safeHref(props.href);
  if (href !== undefined) {
    return (
      <a href={href} aria-current={selected ? 'true' : undefined} class={look(selected)}>
        {props.label}
      </a>
    );
  }
  return (
    <button type="button" aria-pressed={selected ? 'true' : 'false'} class={look(selected)}>
      {props.label}
    </button>
  );
}
