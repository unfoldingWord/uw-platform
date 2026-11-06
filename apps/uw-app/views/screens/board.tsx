import type { Context } from 'hono';
import type { AgentPickup, ExitGate, Principal, Stage } from '@uw/contracts';
import { can } from '@uw/core/acl';
import type { BoardColumn, BoardInput, BoardView, CostTotals } from '@uw/harness';
import type { HarnessEvent } from '@uw/contracts';
import { Chip } from '@uw/ui/components/chip.tsx';
import { CommandForm, commandButton } from '@uw/ui/components/command-form.tsx';
import { TextField } from '@uw/ui/components/field.tsx';
import { Lane } from '@uw/ui/components/lane.tsx';
import { HumanChip } from '@uw/ui/components/human-action.tsx';
import { Icon } from '@uw/ui/components/icon.tsx';
import { cursorOf } from '../../commands/reads.ts';
import type { AppEnv } from '../../deps.ts';
import { BoardCardView, type CardViewer } from '../parts/board-card.tsx';
import { EpicGroups, NotReadyList } from '../parts/epic-board.tsx';
import { renderScreen, screenKernel, screenRefusal } from '../parts/frame.tsx';
import { itemsText } from '../parts/items-count.ts';
import { idParam } from '../parts/params.ts';
import { boardPath, flowPath, gatesPath, homePath } from '../parts/paths.ts';
import { Pipeline } from '../parts/pipeline.tsx';
import { formatMoney } from '@uw/core/money';
import { notFound } from './not-found.tsx';
import { pageNames } from '../parts/names.ts';

const focus = 'outline-offset-2 outline-accent-text focus-visible:outline-2';

const pickupWords: Readonly<Record<AgentPickup, string>> = {
  none: 'No agents',
  allowed: 'Agents may pick up',
  auto: 'Agents pick up automatically',
};

const exitWords: Readonly<Record<ExitGate, string>> = {
  none: 'No gate',
  checks: 'Checks',
  human_approval: 'A person decides',
};

function boardInput(c: Context<AppEnv>, harnessId: string): BoardInput | null {
  const stageKey = c.req.query('stage') ?? null;
  const after = cursorOf(c.req.query('after'));
  if (after === 'malformed' || (after !== null && stageKey === null)) return null;
  return { harnessId, stageKey, after };
}

type Shown = BoardView & { readonly stages: readonly Stage[] };

function viewerOf(actor: Principal, view: BoardView, at: Date): CardViewer {
  const area = { kind: 'area', area: view.harness.jdArea } as const;
  return {
    identity: actor.personId === null ? '' : `human:${actor.personId}`,
    admin: actor.kind === 'person' && can(actor, 'admin', area, at),
    at,
  };
}

function EnqueueForm(props: { readonly harnessId: string }) {
  return (
    <CommandForm harnessId={props.harnessId} command="enqueue">
      <TextField name="title" label="Title" scope={props.harnessId} required maxLength={200} />
      <button type="submit" class={commandButton}>
        Add item
      </button>
    </CommandForm>
  );
}

function ColumnView(props: {
  readonly view: Shown;
  readonly column: BoardColumn;
  readonly first: boolean;
  readonly viewer: CardViewer;
  readonly last: ReadonlyMap<string, HarnessEvent>;
}) {
  const { column, view } = props;
  const folded = !props.first && column.held === 0 && column.cards.length === 0;
  const { stage } = column;
  const harnessId = view.harness.id;
  const items = itemsText(column, view.harness.botAuthors);
  const facts = [
    { label: 'Items', value: items },
    { label: 'Agent pickup', value: pickupWords[stage.agentPickup] },
    { label: 'Exit', value: exitWords[stage.exitGate] },
  ];
  return (
    <Lane
      stageKey={stage.key}
      title={stage.title}
      count={column.held}
      wipLimit={stage.wipLimit}
      paused={stage.paused}
      gate={stage.exitGate === 'human_approval'}
      folded={folded}
      facts={facts}
    >
      {column.cards.map((card) => (
        <BoardCardView
          harnessId={harnessId}
          card={card}
          column={column.cards}
          viewer={props.viewer}
          last={props.last.get(card.item.itemId)}
        />
      ))}
      {column.next === null ? null : (
        <a
          href={`${boardPath(harnessId, stage.key)}&after=${encodeURIComponent(column.next)}`}
          class={`text-accent-text underline ${focus}`}
        >
          Show more
        </a>
      )}
      {props.first ? <EnqueueForm harnessId={harnessId} /> : null}
    </Lane>
  );
}

function StageChips(props: { readonly view: Shown; readonly stageKey: string | null }) {
  const { view } = props;
  const harnessId = view.harness.id;
  return (
    <nav aria-label="Stages" class="mb-4 flex flex-wrap gap-2">
      <Chip label="All stages" href={boardPath(harnessId)} selected={props.stageKey === null} />
      {view.stages.map((stage) => (
        <Chip
          label={stage.title}
          href={boardPath(harnessId, stage.key)}
          selected={props.stageKey === stage.key}
        />
      ))}
    </nav>
  );
}

function specOf(view: Shown, cursor: number) {
  const { harness } = view;
  return {
    title: `${harness.title} ${pageNames.board}`,
    current: boardPath(harness.id),
    crumbs: [
      { label: pageNames.home, href: homePath() },
      { label: harness.title, href: flowPath(harness.id) },
      { label: pageNames.board },
    ],
    tabs: [
      {
        label: pageNames.flow,
        href: flowPath(harness.id),
        icon: 'diagram-project' as const,
        current: false,
      },
      {
        label: pageNames.board,
        href: boardPath(harness.id),
        icon: 'square-kanban' as const,
        current: true,
      },
    ],
    live: { screen: 'board' as const, harnesses: [{ harnessId: harness.id, cursor }] },
  };
}

function totalCost(view: BoardView): CostTotals {
  const cards = view.columns.flatMap((column) => column.cards);
  const sum = (pick: (cost: CostTotals) => number) =>
    cards.reduce((total, card) => total + pick(card.cost), 0);
  return {
    meteredMinor: sum((cost) => cost.meteredMinor),
    computeMinor: sum((cost) => cost.computeMinor),
    meteredTokens: sum((cost) => cost.meteredTokens),
    subscriptionTokens: sum((cost) => cost.subscriptionTokens),
    currency: 'USD',
  };
}

type Tally = {
  readonly items: number;
  readonly waiting: number;
  readonly working: number;
  readonly unclaimed: number;
};

function spentText(cost: CostTotals): string {
  return formatMoney({
    amountMinor: cost.meteredMinor + cost.computeMinor,
    currency: cost.currency,
  });
}

function tallyOf(view: BoardView): Tally {
  const cards = view.columns.flatMap((column) => column.cards);
  return {
    items: view.columns.reduce((total, column) => total + column.held, 0),
    waiting: cards.filter((card) => card.item.gateStatus === 'parked').length,
    working: cards.filter((card) => card.liveRun !== null).length,
    unclaimed: cards.filter((card) => card.item.holder === null).length,
  };
}

function Hero(props: { readonly view: Shown; readonly tally: Tally }) {
  const { view, tally } = props;
  const counts = new Map(view.columns.map((column) => [column.stage.key, column.held]));
  const need = tally.waiting === 0 ? '' : ` · ${tally.waiting} need a person`;
  return (
    <Pipeline
      title={view.harness.title}
      summary={`${tally.items} items moving through ${view.stages.length} stages${need}`}
      stages={view.stages}
      counts={counts}
      figures={[
        { label: 'Agents working', value: String(tally.working) },
        { label: 'Waiting on you', value: String(tally.waiting), person: true },
        {
          label: 'Spent on these items',
          value: spentText(totalCost(view)),
        },
      ]}
    />
  );
}

function Toolbar(props: { readonly tally: Tally }) {
  const quiet = 'inline-flex items-center gap-2 px-3 py-1 text-sm font-semibold text-text-2';
  return (
    <div class="mb-4 flex flex-wrap items-center gap-2">
      <HumanChip label="Waiting on you" count={props.tally.waiting} href={gatesPath()} />
      <span class={quiet}>
        Agents working <span class="font-mono text-text-3">{props.tally.working}</span>
      </span>
      <span class={quiet}>
        Unclaimed <span class="font-mono text-text-3">{props.tally.unclaimed}</span>
      </span>
      <span aria-disabled="true" class={`${quiet} text-text-3`}>
        <Icon name="bars-filter" size={1} />
        Filter
        <span class="text-xs font-regular">Not wired yet</span>
      </span>
    </div>
  );
}

export async function boardScreen(c: Context<AppEnv>): Promise<Response> {
  const screen = screenKernel(c);
  if (screen === null) return screenRefusal(c);
  const harnessId = idParam(c.req.param('harnessId'));
  const input = harnessId === null ? null : boardInput(c, harnessId);
  if (harnessId === null || input === null) return notFound(c);
  const read = { at: screen.at };
  const cursor = await screen.kernel.views.cursor(screen.caller, { harnessId }, read);
  const outcome = await screen.kernel.views.board(screen.caller, input, read);
  if (outcome.status !== 'accepted') return notFound(c);
  const board = outcome.value;
  const scene = await screen.kernel.reads.harness(screen.caller, { harnessId }, read);
  const stages = scene.status === 'accepted' ? scene.value.stages : [];
  const view = {
    ...board,
    stages: [...stages].sort((left, right) => left.position - right.position),
  };
  const viewer = viewerOf(screen.caller.actor, view, screen.at);
  const firstKey = view.stages[0]?.key;
  const itemIds = board.columns.flatMap((column) => column.cards.map((card) => card.item.itemId));
  const events = await screen.kernel.views.lastEvents(screen.caller, { itemIds }, read);
  const last = new Map(events.map((event) => [event.itemId ?? '', event]));
  const tally = tallyOf(board);
  return renderScreen(
    c,
    specOf(view, cursor),
    <>
      <Hero view={view} tally={tally} />
      <Toolbar tally={tally} />
      <StageChips view={view} stageKey={input.stageKey} />
      <EpicGroups harnessId={harnessId} epics={board.epics} />
      <NotReadyList harnessId={harnessId} entries={board.notReady} />
      <div class="flex items-start gap-3 overflow-x-auto pb-2">
        {board.columns.map((column) => (
          <ColumnView
            view={view}
            column={column}
            first={column.stage.key === firstKey}
            viewer={viewer}
            last={last}
          />
        ))}
      </div>
    </>,
  );
}
