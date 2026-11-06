import { Icon } from './icon.tsx';
import { domId, reasonText } from './text.ts';

export const humanGateSvg = 'fill-human-soft stroke-human';

const action =
  'inline-flex items-center rounded-md bg-human px-4 py-2 text-sm font-heavy text-on-accent outline-offset-2 outline-accent-text focus-visible:outline-2 aria-disabled:cursor-not-allowed aria-disabled:bg-human-soft aria-disabled:text-text';

export function HumanActionButton(props: {
  readonly itemId: string;
  readonly label: string;
  readonly name: string;
  readonly value: string;
  readonly disabledReason?: string | null;
}) {
  const reason = props.disabledReason ?? null;
  const reasonId =
    reason === null ? undefined : domId('action', props.itemId, props.name, props.value);
  return (
    <span class="inline-flex flex-wrap items-center gap-2">
      <button
        type={reason === null ? 'submit' : 'button'}
        name={props.name}
        value={props.value}
        aria-disabled={reason === null ? undefined : 'true'}
        aria-describedby={reasonId}
        class={action}
      >
        {props.label}
      </button>
      {reason === null ? null : (
        <span id={reasonId} class="text-sm text-text-3">
          {reasonText(reason)}
        </span>
      )}
    </span>
  );
}

export function HumanGateMark(props: { readonly label: string }) {
  return (
    <span class="inline-flex items-center rounded-sm border border-human bg-human-soft px-2 py-1 text-xs font-heavy text-text">
      {props.label}
    </span>
  );
}

export function PersonCount(props: { readonly count: number; readonly label: string }) {
  return (
    <span
      aria-label={props.label}
      class="ml-auto flex h-size-4 items-center rounded-full bg-human px-2 font-mono text-xs font-heavy text-on-accent"
    >
      {props.count}
    </span>
  );
}

export const humanLane = 'border border-human-line bg-glow-human';

export const humanNode = 'border-human bg-human-soft text-human-text shadow-person';

export function HumanMark(props: { readonly label: string }) {
  return (
    <span role="img" aria-label={props.label} class="inline-flex text-human">
      <Icon name="user-check" size={1} />
    </span>
  );
}

export function HumanWaitChip(props: { readonly text: string }) {
  return (
    <span class="inline-flex w-fit items-center gap-1 rounded-full border border-human-line bg-human-soft px-2 py-1 text-xs font-semibold text-human-text">
      <Icon name="user-check" size={1} />
      {props.text}
    </span>
  );
}

export function HumanChip(props: {
  readonly label: string;
  readonly count: number;
  readonly href: string;
}) {
  return (
    <a
      href={props.href}
      class="inline-flex items-center gap-2 rounded-full border border-human-line bg-human-soft px-3 py-1 text-sm font-semibold text-human-text outline-offset-2 outline-accent-text focus-visible:outline-2"
    >
      <Icon name="user-check" size={1} />
      {props.label}
      <span class="font-mono font-heavy">{props.count}</span>
    </a>
  );
}

export const humanFigure = 'text-human-text';
