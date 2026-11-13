import type { Child } from 'hono/jsx';
import { Badge } from './badge.tsx';
import { HumanMark, humanLane } from './human-action.tsx';
import { domId } from './text.ts';

const column = 'flex w-aside shrink-0 flex-col gap-2 rounded-md bg-lane p-3';

function Facts(props: {
  readonly facts: readonly { readonly label: string; readonly value: string }[];
}) {
  if (props.facts.length === 0) return null;
  return (
    <dl class="sr-only">
      {props.facts.map((fact) => (
        <>
          <dt class="text-text-3">{fact.label}</dt>
          <dd class="m-0 text-text-2">{fact.value}</dd>
        </>
      ))}
    </dl>
  );
}

function LaneBadges(props: { readonly gate: boolean; readonly paused: boolean }) {
  if (!props.gate && !props.paused) return null;
  return (
    <div class="flex flex-wrap gap-1 px-1">
      {props.gate ? (
        <Badge tone="person">
          <HumanMark label="A person decides" />
          gate: a person decides
        </Badge>
      ) : null}
      {props.paused ? <Badge tone="held">Paused</Badge> : null}
    </div>
  );
}

export function Lane(props: {
  readonly stageKey: string;
  readonly title: string;
  readonly count: number;
  readonly wipLimit: number;
  readonly paused?: boolean;
  readonly gate?: boolean;
  readonly folded?: boolean;
  readonly facts?: readonly { readonly label: string; readonly value: string }[];
  readonly children?: Child;
}) {
  const headingId = domId('lane', props.stageKey);
  const gate = props.gate === true;
  return (
    <section
      aria-labelledby={headingId}
      data-folded={props.folded === true ? 'true' : undefined}
      class={`${column} ${gate ? humanLane : ''}`}
    >
      <div class="flex items-center gap-2 px-1">
        <h2
          id={headingId}
          class="m-0 min-w-0 truncate text-xs font-heavy tracking-wide text-text-3 uppercase"
        >
          {props.title}
        </h2>
        <p class="m-0 ml-auto font-mono text-xs whitespace-nowrap text-text-3">
          {`${props.count} of ${props.wipLimit}`}
          <span class="sr-only"> items against the WIP limit</span>
        </p>
      </div>
      <LaneBadges gate={gate} paused={props.paused === true} />
      <Facts facts={props.facts ?? []} />
      <div class="flex flex-col gap-2">
        {props.children}
        {props.count === 0 ? (
          <p class="m-0 rounded-md border border-dashed border-line px-3 py-3 text-center text-xs text-text-3">
            No items
          </p>
        ) : null}
      </div>
    </section>
  );
}
