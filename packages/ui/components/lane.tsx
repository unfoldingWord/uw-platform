import type { Child } from 'hono/jsx';
import { Badge } from './badge.tsx';
import { HumanMark, humanLane } from './human-action.tsx';
import { domId } from './text.ts';

const column = 'flex w-aside shrink-0 flex-col gap-2 rounded-lg bg-raised p-2';

export type LaneFact = {
  readonly label: string;
  readonly value: string;
  readonly person?: boolean;
};

function FactValue(props: { readonly fact: LaneFact }) {
  const { fact } = props;
  if (fact.person !== true) return <dd class="m-0 text-text-2">{fact.value}</dd>;
  return (
    <dd class="m-0">
      <Badge tone="person">
        <HumanMark label={fact.value} />
        {fact.value}
      </Badge>
    </dd>
  );
}

function Facts(props: { readonly facts: readonly LaneFact[] }) {
  if (props.facts.length === 0) return null;
  return (
    <dl class="m-0 grid grid-cols-label items-center gap-x-3 gap-y-1 px-1 text-xs">
      {props.facts.map((fact) => (
        <>
          <dt class="text-text-3">{fact.label}</dt>
          <FactValue fact={fact} />
        </>
      ))}
    </dl>
  );
}

type Attributes = Readonly<Record<string, string | undefined>>;

function Count(props: {
  readonly count: number;
  readonly wipLimit: number | null;
  readonly unit: string;
}) {
  const limited = props.wipLimit !== null;
  return (
    <p class="m-0 ml-auto font-mono text-xs whitespace-nowrap text-text-3">
      {limited ? `${props.count} of ${props.wipLimit}` : String(props.count)}
      <span class="sr-only">
        {limited ? ` ${props.unit} against the WIP limit` : ` ${props.unit}`}
      </span>
    </p>
  );
}

function LaneBadges(props: { readonly paused: boolean }) {
  if (!props.paused) return null;
  return (
    <div class="flex flex-wrap gap-1 px-1">
      <Badge tone="held">Paused</Badge>
    </div>
  );
}

export function Lane(props: {
  readonly stageKey: string;
  readonly title: string;
  readonly count: number;
  readonly wipLimit: number | null;
  readonly unit?: string | undefined;
  readonly attrs?: Attributes | undefined;
  readonly listAttrs?: Attributes | undefined;
  readonly paused?: boolean;
  readonly gate?: boolean;
  readonly folded?: boolean;
  readonly facts?: readonly LaneFact[];
  readonly children?: Child;
}) {
  const headingId = domId('lane', props.stageKey);
  const gate = props.gate === true;
  const unit = props.unit ?? 'items';
  return (
    <section
      aria-labelledby={headingId}
      data-folded={props.folded === true ? 'true' : undefined}
      class={`${column} ${gate ? humanLane : ''}`}
      {...(props.attrs ?? {})}
    >
      <div class="flex items-center gap-2 px-1 pt-1">
        <h2 id={headingId} class="m-0 min-w-0 truncate text-sm font-heavy text-text">
          {props.title}
        </h2>
        <Count count={props.count} wipLimit={props.wipLimit} unit={unit} />
      </div>
      <LaneBadges paused={props.paused === true} />
      <Facts facts={props.facts ?? []} />
      <div class="flex flex-col gap-2" {...(props.listAttrs ?? {})}>
        {props.children}
        {props.count === 0 ? (
          <p class="m-0 rounded-md border border-dashed border-line px-3 py-3 text-center text-sm text-text-3">
            {`No ${unit}`}
          </p>
        ) : null}
      </div>
    </section>
  );
}
