import { Badge, type BadgeTone } from './badge.tsx';

export function Kpi(props: {
  readonly label: string;
  readonly value: string;
  readonly detail?: string;
  readonly tone?: BadgeTone;
}) {
  return (
    <dl class="m-0 rounded-lg border border-line bg-surface p-4">
      <dt class="text-sm text-muted">{props.label}</dt>
      <dd class="m-0 mt-1 text-2xl font-extrabold text-ink">
        {props.tone === undefined ? props.value : <Badge tone={props.tone}>{props.value}</Badge>}
      </dd>
      {props.detail === undefined ? null : (
        <dd class="m-0 mt-1 text-sm text-muted">{props.detail}</dd>
      )}
    </dl>
  );
}
