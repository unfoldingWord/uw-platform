import type { Context } from 'hono';
import type { StageBracket } from '@uw/contracts';
import { formatDuration } from '@uw/core/dates';
import { formatCount } from '@uw/core/money';
import { VIEW_LIMIT, type PhaseCount, type QueueCard } from '@uw/harness';
import { Badge } from '@uw/ui/components/badge.tsx';
import { Note } from '@uw/ui/components/note.tsx';
import { PageHead } from '@uw/ui/components/page-head.tsx';
import { domId } from '@uw/ui/components/text.ts';
import type { AppEnv } from '../../deps.ts';
import { liveCursors } from '../parts/cursors.ts';
import { bracketText } from '../parts/flow-diagram.tsx';
import { renderScreen, screenKernel, screenRefusal } from '../parts/frame.tsx';
import { moduleCodes, pageNames } from '../parts/names.ts';
import { agentQueuesPath, boardPath } from '../parts/paths.ts';

const REFRESH_EVERY_MS = 60_000;
const focus = 'outline-offset-2 outline-accent-text focus-visible:outline-2';

const phaseFill: Readonly<Record<StageBracket, string>> = {
  product_package: 'fill-ok',
  build_package: 'fill-accent',
  deploy_package: 'fill-text-2',
  iterate: 'fill-text-3',
};

const phaseSwatch: Readonly<Record<StageBracket, string>> = {
  product_package: 'bg-ok',
  build_package: 'bg-accent',
  deploy_package: 'bg-text-2',
  iterate: 'bg-text-3',
};

type Segment = { readonly phase: StageBracket; readonly x: number; readonly width: number };

function segmentsOf(phases: readonly PhaseCount[]): readonly Segment[] {
  const total = phases.reduce((sum, phase) => sum + phase.count, 0);
  if (total === 0) return [];
  let x = 0;
  return phases.flatMap((phase) => {
    if (phase.count === 0) return [];
    const width = (phase.count / total) * 100;
    const segment = { phase: phase.phase, x, width };
    x += width;
    return [segment];
  });
}

function PhaseBar(props: { readonly phases: readonly PhaseCount[] }) {
  return (
    <span class="block overflow-hidden rounded-sm">
      <svg
        viewBox="0 0 100 8"
        preserveAspectRatio="none"
        aria-hidden="true"
        focusable="false"
        class="block h-2 w-full"
      >
        <rect x="0" y="0" width="100" height="8" class="fill-line-soft" />
        {segmentsOf(props.phases).map((segment) => (
          <rect
            x={String(segment.x)}
            y="0"
            width={String(segment.width)}
            height="8"
            class={phaseFill[segment.phase]}
          />
        ))}
      </svg>
    </span>
  );
}

function PhaseCounts(props: { readonly phases: readonly PhaseCount[] }) {
  return (
    <ul aria-label="Open items by phase" class="m-0 grid list-none grid-cols-2 gap-3 p-0">
      {props.phases.map((phase) => (
        <li class="flex flex-col gap-1">
          <span class="text-md leading-tight font-heavy text-text tabular-nums">
            {formatCount(phase.count)}
          </span>
          <span class="flex items-center gap-1 text-xs font-semibold text-text-3">
            <span aria-hidden="true" class={`size-2 rounded-sm ${phaseSwatch[phase.phase]}`} />
            {bracketText(phase.phase)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function oldestText(card: QueueCard, at: Date): string {
  if (card.oldestEnteredAt === null) return 'No open items';
  return `Oldest item: ${formatDuration(at.getTime() - card.oldestEnteredAt.getTime())}`;
}

function WaitingBadge(props: { readonly waiting: number }) {
  if (props.waiting === 0) return <Badge tone="neutral">Nothing waiting on you</Badge>;
  return <Badge tone="person">{`${formatCount(props.waiting)} waiting on you`}</Badge>;
}

function WorkflowCard(props: { readonly card: QueueCard; readonly at: Date }) {
  const { card } = props;
  const { harness } = card;
  const titleId = domId('queue', harness.id);
  return (
    <section
      aria-labelledby={titleId}
      class="flex min-w-0 flex-col gap-3 rounded-md border border-line bg-surface p-4"
    >
      <h2 id={titleId} class="m-0 text-md font-heavy">
        <a href={boardPath(harness.id)} class={`text-text hover:text-accent-text ${focus}`}>
          {harness.title}
        </a>
      </h2>
      <p class="m-0 flex flex-wrap items-center gap-2 text-sm text-text-3">
        <span class="rounded-sm bg-accent-soft px-1 font-mono text-xs text-accent-text">
          {harness.jdArea}
        </span>
        <span>{harness.repository ?? 'No repository'}</span>
      </p>
      <PhaseBar phases={card.phases} />
      <PhaseCounts phases={card.phases} />
      {card.capped ? (
        <p class="m-0 text-xs text-text-3">{`Counts the first ${formatCount(VIEW_LIMIT)} open items.`}</p>
      ) : null}
      <p class="m-0 flex flex-wrap items-center justify-between gap-2 border-t border-line-soft pt-3 text-sm text-text-3">
        <span>{oldestText(card, props.at)}</span>
        <WaitingBadge waiting={card.waiting} />
      </p>
    </section>
  );
}

function Workflows(props: { readonly cards: readonly QueueCard[]; readonly at: Date }) {
  if (props.cards.length === 0) {
    return (
      <Note>
        You don't have access to any workflows yet. Ask an admin of the area your work belongs to
        for access.
      </Note>
    );
  }
  return (
    <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
      {props.cards.map((card) => (
        <WorkflowCard card={card} at={props.at} />
      ))}
    </div>
  );
}

export async function agentQueuesScreen(c: Context<AppEnv>): Promise<Response> {
  const screen = screenKernel(c);
  if (screen === null) return screenRefusal(c);
  const read = { at: screen.at };
  const { cards } = await screen.kernel.views.queues(screen.caller, read);
  const cursors = await screen.kernel.views.cursors(screen.caller, read);
  const harnesses = liveCursors(
    cursors,
    cards.map((card) => card.harness.id),
  );
  const spec = {
    title: pageNames.agentQueues,
    current: agentQueuesPath(),
    code: moduleCodes.agentQueues,
    crumbs: [{ label: pageNames.infrastructure }, { label: pageNames.agentQueues }],
    live: { screen: 'queues' as const, harnesses, refreshEveryMs: REFRESH_EVERY_MS },
  };
  return renderScreen(
    c,
    spec,
    <div class="flex flex-col gap-5">
      <PageHead
        eyebrow={pageNames.agentQueues}
        title="Your workflows"
        lede="A workflow is a set of stages that work moves through, with the people and agents who do it. You see the workflows in the areas you have access to."
        flush
      />
      <Workflows cards={cards} at={screen.at} />
    </div>,
  );
}
