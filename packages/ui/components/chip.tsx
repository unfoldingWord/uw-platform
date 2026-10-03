import { safeHref } from './href.ts';

const base =
  'inline-flex items-center rounded-lg border px-3 py-1 text-sm outline-offset-2 outline-focus focus-visible:outline-2';

function look(selected: boolean): string {
  return selected
    ? `${base} border-ocean bg-inspire-soft font-bold text-ocean`
    : `${base} border-line bg-surface text-ink`;
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
