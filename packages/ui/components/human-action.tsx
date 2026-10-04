import { domId, reasonText } from './text.ts';

export const humanGateSvg = 'fill-kindle-soft stroke-kindle';

const action =
  'inline-flex items-center rounded-md bg-kindle px-4 py-2 text-sm font-bold text-on-accent outline-offset-2 outline-focus focus-visible:outline-2 aria-disabled:cursor-not-allowed aria-disabled:bg-kindle-soft aria-disabled:text-ink';

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
        <span id={reasonId} class="text-sm text-muted">
          {reasonText(reason)}
        </span>
      )}
    </span>
  );
}

export function HumanGateMark(props: { readonly label: string }) {
  return (
    <span class="inline-flex items-center rounded-sm border border-kindle bg-kindle-soft px-2 py-0.5 text-xs font-bold text-ink">
      {props.label}
    </span>
  );
}
