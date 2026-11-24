import type { Context } from 'hono';
import type { StageBracket } from '@uw/contracts';
import type { ReadableAreas } from '@uw/core/acl';
import { formatDuration } from '@uw/core/dates';
import { formatCount } from '@uw/core/money';
import { VIEW_LIMIT, type PhaseCount, type QueueCard } from '@uw/harness';
import { Badge } from '@uw/ui/components/badge.tsx';
import { ButtonLink } from '@uw/ui/components/button.tsx';
import { ListRow, RowList } from '@uw/ui/components/list-row.tsx';
import { Note } from '@uw/ui/components/note.tsx';
import { Section } from '@uw/ui/components/section.tsx';
import { ListShape } from '@uw/ui/shapes/list.tsx';
import type { AppEnv } from '../../deps.ts';
import { liveCursors } from '../parts/cursors.ts';
import { bracketText } from '../parts/flow-diagram.tsx';
import { renderScreen, screenKernel, screenRefusal } from '../parts/frame.tsx';
import { moduleCodes, pageNames } from '../parts/names.ts';
import { agentQueuesPath, newWorkflowPath, queuePath } from '../parts/paths.ts';

const REFRESH_EVERY_MS = 60_000;

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
    <span role="group" aria-label="Open items by phase" class="flex flex-wrap gap-x-3 gap-y-1">
      {props.phases.map((phase) => (
        <span class="inline-flex items-center gap-1">
          <span aria-hidden="true" class={`size-2 rounded-sm ${phaseSwatch[phase.phase]}`} />
          <span class="font-semibold text-text tabular-nums">{formatCount(phase.count)}</span>
          {bracketText(phase.phase)}
        </span>
      ))}
    </span>
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

function cappedText(card: QueueCard): string | null {
  return card.capped ? `Counts the first ${formatCount(VIEW_LIMIT)} open items.` : null;
}

function WorkflowMeta(props: { readonly card: QueueCard; readonly at: Date }) {
  const { card } = props;
  return (
    <span class="mt-1 flex flex-col gap-2">
      <span class="flex flex-wrap items-center gap-x-2">
        <span class="font-mono text-xs text-accent-text">{card.harness.jdArea}</span>
        <span>{card.harness.repository ?? 'No repository'}</span>
        <span>{`· ${oldestText(card, props.at)}`}</span>
      </span>
      <PhaseBar phases={card.phases} />
      <PhaseCounts phases={card.phases} />
      {cappedText(card)}
    </span>
  );
}

function WorkflowRow(props: { readonly card: QueueCard; readonly at: Date }) {
  const { card } = props;
  return (
    <ListRow
      title={card.harness.title}
      href={queuePath(card.harness.id)}
      meta={<WorkflowMeta card={card} at={props.at} />}
      trail={<WaitingBadge waiting={card.waiting} />}
    />
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
    <Section title="Workflows" sub={formatCount(props.cards.length)}>
      <RowList label="Workflows">
        {props.cards.map((card) => (
          <WorkflowRow card={card} at={props.at} />
        ))}
      </RowList>
    </Section>
  );
}

function canCreate(held: ReadableAreas): boolean {
  return held.kind === 'all' || held.areas.length > 0;
}

export async function agentQueuesScreen(c: Context<AppEnv>): Promise<Response> {
  const screen = screenKernel(c);
  if (screen === null) return screenRefusal(c);
  const read = { at: screen.at };
  const { cards } = await screen.kernel.views.queues(screen.caller, read);
  const cursors = await screen.kernel.views.cursors(screen.caller, read);
  const creatable = await screen.kernel.views.creatableAreas(screen.caller, read);
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
    <ListShape
      head={{
        eyebrow: pageNames.agentQueues,
        title: 'Your workflows',
        lede: 'A workflow is a set of stages that work moves through, with the people and agents who do it. You see the workflows in the areas you have access to.',
        actions: canCreate(creatable) ? (
          <ButtonLink href={newWorkflowPath()} variant="primary" icon="plus">
            New workflow
          </ButtonLink>
        ) : undefined,
      }}
    >
      <Workflows cards={cards} at={screen.at} />
    </ListShape>,
  );
}
