import { Icon } from './icon.tsx';
import { domId, reasonText } from './text.ts';

export const humanGateSvg = 'fill-human-soft stroke-human';

const action =
  'inline-flex items-center rounded-md border border-human bg-human px-3 py-1 text-sm font-heavy text-on-accent outline-offset-2 outline-accent-text focus-visible:outline-2 aria-disabled:cursor-not-allowed aria-disabled:border-human-line aria-disabled:bg-human-soft aria-disabled:text-human-text';

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
    <span class="inline-flex items-center rounded-sm border border-human-line bg-human-soft px-1 text-xs leading-normal font-heavy text-human-text">
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

export const humanLane = 'border border-human-line';

export const humanBadge = 'border border-human-line bg-human-soft text-human-text';

export const humanRule = 'border-t-human';

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
    <span class="inline-flex h-size-4 w-fit items-center gap-1 rounded-full border border-human-line bg-human-soft px-2 text-xs font-heavy text-human-text">
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
      class="inline-flex h-size-4 items-center gap-1 rounded-full border border-human-line bg-human-soft px-2 text-xs font-heavy text-human-text outline-offset-2 outline-accent-text focus-visible:outline-2"
    >
      <Icon name="user-check" size={1} />
      {props.label}
      <span class="font-mono font-heavy">{props.count}</span>
    </a>
  );
}

export const humanFigure = 'text-human-text';

export function HumanCallout(props: { readonly lead: string; readonly text: string }) {
  return (
    <p
      data-human-callout=""
      class="m-0 flex items-start gap-2 rounded-md border border-human-line bg-human-soft px-3 py-2 text-sm font-semibold text-human-text"
    >
      <Icon name="lock" size={2} />
      <span>
        <strong class="font-heavy">{props.lead}</strong> {props.text}
      </span>
    </p>
  );
}

export function HumanDot() {
  return <span aria-hidden="true" class="mt-1 size-size-1 shrink-0 rounded-full bg-human"></span>;
}

export function HumanTile() {
  return (
    <span class="grid size-size-6 shrink-0 place-items-center rounded-md border border-human-line bg-human-soft text-human shadow-person">
      <Icon name="user-check" size={3} />
    </span>
  );
}

export const humanBar = 'bg-human';
