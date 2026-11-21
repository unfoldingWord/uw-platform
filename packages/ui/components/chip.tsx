import { Icon, type IconProps } from './icon.tsx';
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

const toggle =
  'inline-flex size-size-5 items-center justify-center rounded-sm text-text-2 outline-offset-2 outline-accent-text hover:bg-hover hover:text-text focus-visible:outline-2 data-on:bg-accent-soft data-on:text-accent-text';

const sideToggle =
  'inline-flex size-size-5 items-center justify-center rounded-full text-side-text outline-offset-2 outline-side-code hover:bg-side-hover focus-visible:outline-2 data-on:bg-accent data-on:text-on-accent';

export function IconToggle(props: {
  readonly format: string;
  readonly label: string;
  readonly icon: IconProps['name'];
  readonly tone?: 'side' | undefined;
}) {
  return (
    <button
      type="button"
      data-format={props.format}
      aria-label={props.label}
      aria-pressed="false"
      title={props.label}
      class={props.tone === 'side' ? sideToggle : toggle}
    >
      <Icon name={props.icon} size={1} />
    </button>
  );
}

const favourite =
  'inline-flex h-size-5 items-center gap-2 rounded-md border border-line bg-surface px-3 text-sm font-heavy text-text-2 outline-offset-2 outline-accent-text hover:border-accent hover:text-accent-text focus-visible:outline-2 data-on:border-accent data-on:bg-accent-soft data-on:text-accent-text';

export function FavouriteToggle(props: {
  readonly pageId: string;
  readonly on: boolean;
  readonly compact?: boolean | undefined;
}) {
  const compact = props.compact === true;
  const state = props.on ? { 'data-on': '' } : {};
  return (
    <button
      type="button"
      data-favourite={props.pageId}
      aria-pressed={props.on ? 'true' : 'false'}
      {...state}
      class={compact ? favourite.replace('px-3', 'px-2') : favourite}
    >
      <Icon name="star" size={1} />
      <span class={compact ? 'sr-only' : ''}>Favourite</span>
    </button>
  );
}
