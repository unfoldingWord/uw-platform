import type { Child } from 'hono/jsx';
import { Badge } from './badge.tsx';
import { domId } from './text.ts';

export function Lane(props: {
  readonly stageKey: string;
  readonly title: string;
  readonly count: number;
  readonly wipLimit: number;
  readonly paused?: boolean;
  readonly facts?: readonly { readonly label: string; readonly value: string }[];
  readonly children?: Child;
}) {
  const facts = props.facts ?? [];
  const headingId = domId('lane', props.stageKey);
  return (
    <section
      aria-labelledby={headingId}
      class="flex min-w-0 flex-col gap-3 rounded-lg border border-line bg-bg p-3"
    >
      <div class="flex flex-wrap items-center gap-2">
        <h2 id={headingId} class="m-0 text-base font-bold text-ink">
          {props.title}
        </h2>
        <p class="m-0 text-sm text-muted">
          {`${props.count} of ${props.wipLimit}`}
          <span class="sr-only"> items against the WIP limit</span>
        </p>
        {props.paused === true ? <Badge tone="held">Paused</Badge> : null}
      </div>
      {facts.length === 0 ? null : (
        <dl class="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          {facts.map((fact) => (
            <>
              <dt class="text-muted">{fact.label}</dt>
              <dd class="m-0 text-ink">{fact.value}</dd>
            </>
          ))}
        </dl>
      )}
      <div class="flex flex-col gap-2">{props.children}</div>
    </section>
  );
}
