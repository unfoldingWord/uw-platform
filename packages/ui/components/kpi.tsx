import type { Child } from 'hono/jsx';
import { Badge, type BadgeTone } from './badge.tsx';
import { humanFigure } from './human-action.tsx';

export function Kpi(props: {
  readonly label: string;
  readonly value: string;
  readonly detail?: string | undefined;
  readonly tone?: BadgeTone | undefined;
  readonly plain?: boolean | undefined;
  readonly person?: boolean | undefined;
}) {
  const rule = props.person === true ? 'border-t-human' : 'border-t-accent';
  const frame =
    props.plain === true
      ? ''
      : `rounded-md border border-line border-t-4 ${rule} bg-surface px-4 py-3`;
  const ink = props.person === true ? humanFigure : 'text-text';
  return (
    <dl class={`m-0 ${frame}`}>
      <dt class="text-xs font-heavy tracking-wide whitespace-nowrap text-text-3 uppercase">
        {props.label}
      </dt>
      <dd class={`m-0 mt-1 text-xl leading-tight font-heavy tracking-tight tabular-nums ${ink}`}>
        {props.tone === undefined ? props.value : <Badge tone={props.tone}>{props.value}</Badge>}
      </dd>
      {props.detail === undefined ? null : (
        <dd class="m-0 mt-1 text-xs text-text-3">{props.detail}</dd>
      )}
    </dl>
  );
}

export function KpiRow(props: {
  readonly label: string;
  readonly status: Child;
  readonly detail: string;
  readonly quiet: boolean;
}) {
  return (
    <dl class="m-0 grid grid-cols-1 gap-1 border-b border-line-soft px-4 py-2 last:border-b-0 md:grid-cols-indicator md:items-center md:gap-4">
      <dt class="text-sm font-heavy text-text">{props.label}</dt>
      <dd class="m-0 md:order-3">{props.status}</dd>
      <dd class={`m-0 text-sm md:order-2 ${props.quiet ? 'text-text-3' : 'text-text'}`}>
        {props.detail}
      </dd>
    </dl>
  );
}
