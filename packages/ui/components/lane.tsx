import type { Child } from 'hono/jsx';
import { Badge } from './badge.tsx';
import { HumanMark, humanLane } from './human-action.tsx';
import { Icon } from './icon.tsx';
import { domId } from './text.ts';

const column = 'flex shrink-0 flex-col gap-3 rounded-lg p-2';

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
  const width = props.folded === true ? 'w-size-7' : 'min-w-col-min max-w-col-max flex-1';
  return (
    <section
      aria-labelledby={headingId}
      data-folded={props.folded === true ? 'true' : undefined}
      class={`${column} ${width} ${gate ? humanLane : 'bg-side'}`}
    >
      <div class={`flex items-center gap-2 ${props.folded === true ? 'flex-col' : ''}`}>
        <Icon name="circle-dot" size={2} class="text-accent-text" />
        <h2
          id={headingId}
          class={`m-0 min-w-0 truncate text-sm font-heavy text-text ${props.folded === true ? 'text-vertical' : ''}`}
        >
          {props.title}
        </h2>
        <p class="m-0 font-mono text-xs text-text-3">
          {`${props.count}/${props.wipLimit}`}
          <span class="sr-only"> items against the WIP limit</span>
        </p>
        {gate ? <HumanMark label="A person decides" /> : null}
        {props.paused === true ? <Badge tone="held">Paused</Badge> : null}
      </div>
      <Facts facts={props.facts ?? []} />
      <div class="flex flex-col gap-2">{props.children}</div>
    </section>
  );
}
