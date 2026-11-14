import type { Context } from 'hono';
import type { AgentPickup, ExitGate, Principal, Stage, StageBracket } from '@uw/contracts';
import { can } from '@uw/core/acl';
import type { BoardColumn, BoardInput, BoardView, CostTotals } from '@uw/harness';
import type { HarnessEvent } from '@uw/contracts';
import { Chip } from '@uw/ui/components/chip.tsx';
import { CommandForm, commandButton } from '@uw/ui/components/command-form.tsx';
import { TextField } from '@uw/ui/components/field.tsx';
import { Lane, type LaneFact } from '@uw/ui/components/lane.tsx';
import { HumanChip } from '@uw/ui/components/human-action.tsx';
import { Icon } from '@uw/ui/components/icon.tsx';
import { Kpi } from '@uw/ui/components/kpi.tsx';
import { PageHead } from '@uw/ui/components/page-head.tsx';
import { cursorOf } from '../../commands/reads.ts';
import type { AppEnv } from '../../deps.ts';
import { QueueCardView, type CardViewer } from '../parts/queue-card.tsx';
import { EpicGroups, NotReadyList } from '../parts/epic-board.tsx';
import { bracketText } from '../parts/flow-diagram.tsx';
import { renderScreen, screenKernel, screenRefusal } from '../parts/frame.tsx';
import { itemsText } from '../parts/items-count.ts';
import { idParam } from '../parts/params.ts';
import { queuePath, flowPath, gatesPath } from '../parts/paths.ts';
import { moduleCodes } from '../parts/names.ts';
import { workflowCrumbs, workflowTabs } from '../parts/workflow-tabs.ts';
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
  none: 'Nothing',
  checks: 'Checks pass',
  human_approval: 'A person approves',
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
    canClaim: can(actor, 'write', area, at),
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

function laneFacts(view: Shown, column: BoardColumn): readonly LaneFact[] {
  const { stage } = column;
  return [
    { label: 'Items', value: itemsText(column, view.harness.botAuthors) },
    { label: 'Agent pickup', value: pickupWords[stage.agentPickup] },
    {
      label: 'To leave',
      value: exitWords[stage.exitGate],
      person: stage.exitGate === 'human_approval',
    },
  ];
}

function ColumnView(props: {
  readonly view: Shown;
  readonly column: BoardColumn;
  readonly first: boolean;
  readonly viewer: CardViewer;
  readonly marks: Marks;
}) {
  const { column, view } = props;
  const folded = !props.first && column.held === 0 && column.cards.length === 0;
  const { stage } = column;
  const harnessId = view.harness.id;
  return (
    <Lane
      stageKey={stage.key}
      title={stage.title}
      count={column.held}
      wipLimit={stage.wipLimit}
      paused={stage.paused}
      gate={stage.exitGate === 'human_approval'}
      folded={folded}
      facts={laneFacts(view, column)}
    >
      {column.cards.map((card) => (
        <QueueCardView
          harnessId={harnessId}
          card={card}
          column={column.cards}
          viewer={props.viewer}
          last={props.marks.last.get(card.item.itemId)}
          refusal={props.marks.refusals.get(card.item.itemId)}
        />
      ))}
      {column.next === null ? null : (
        <a
          href={`${queuePath(harnessId, stage.key)}&after=${encodeURIComponent(column.next)}`}
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
    <nav aria-label="Stages" class="mb-5 flex flex-wrap items-center gap-2">
      <span class="mr-1 text-xs font-heavy tracking-wide text-text-3 uppercase">Stage</span>
      <Chip label="All stages" href={queuePath(harnessId)} selected={props.stageKey === null} />
      {view.stages.map((stage) => (
        <Chip
          label={stage.title}
          href={queuePath(harnessId, stage.key)}
          selected={props.stageKey === stage.key}
        />
      ))}
    </nav>
  );
}

function specOf(view: Shown, cursor: number) {
  const { harness } = view;
  return {
    title: `${harness.title} ${pageNames.queue}`,
    current: queuePath(harness.id),
    code: moduleCodes.agentQueues,
    crumbs: workflowCrumbs(harness.title, flowPath(harness.id), pageNames.queue),
    tabs: workflowTabs(harness.id, 'queue'),
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

function Head(props: { readonly view: Shown; readonly tally: Tally }) {
  const { view, tally } = props;
  const need = tally.waiting === 0 ? '' : ` ${tally.waiting} need a person.`;
  return (
    <PageHead
      eyebrow={`Workflow · ${view.stages.length} stages`}
      title={view.harness.title}
      lede={`${tally.items} items moving through ${view.stages.length} stages. Agents claim cards like anyone else; a person decides at the gate.${need}`}
      actions={
        <div aria-label="Figures" role="group" class="flex flex-wrap gap-6">
          <Kpi label="Agents working" value={String(tally.working)} plain />
          <Kpi label="Waiting on you" value={String(tally.waiting)} plain person />
          <Kpi label="Spent on these items" value={spentText(totalCost(view))} plain />
        </div>
      }
    />
  );
}

function Toolbar(props: { readonly tally: Tally }) {
  const quiet = 'inline-flex items-center gap-2 px-2 text-sm font-semibold text-text-2';
  return (
    <div class="mb-3 flex flex-wrap items-center gap-2">
      <HumanChip label="Waiting on you" count={props.tally.waiting} href={gatesPath()} />
      <span class={quiet}>
        Agents working <span class="font-mono text-text-3">{props.tally.working}</span>
      </span>
      <span class={quiet}>
        Unclaimed <span class="font-mono text-text-3">{props.tally.unclaimed}</span>
      </span>
      <span aria-disabled="true" class={`${quiet} cursor-default text-text-3 opacity-45`}>
        <Icon name="bars-filter" size={1} />
        Filter
      </span>
    </div>
  );
}

type Marks = {
  readonly last: ReadonlyMap<string, HarnessEvent>;
  readonly refusals: ReadonlyMap<string, HarnessEvent>;
};

type Screen = NonNullable<ReturnType<typeof screenKernel>>;

function byItem(events: readonly HarnessEvent[]): ReadonlyMap<string, HarnessEvent> {
  return new Map(events.map((event) => [event.itemId ?? '', event]));
}

async function cardMarks(screen: Screen, board: BoardView, read: { readonly at: Date }) {
  const cards = board.columns.flatMap((column) => column.cards);
  const itemIds = cards.map((card) => card.item.itemId);
  const stageOf = new Map(cards.map((card) => [card.item.itemId, card.item.stageKey]));
  const { views } = screen.kernel;
  const last = await views.lastEvents(screen.caller, { itemIds }, read);
  const refusals = await views.refusals(screen.caller, { itemIds }, read);
  const current = refusals.filter(
    (event) => event.evidence['stage'] === stageOf.get(event.itemId ?? ''),
  );
  return { last: byItem(last), refusals: byItem(current) };
}

type Phase = { readonly bracket: StageBracket; readonly columns: readonly BoardColumn[] };

function phasesOf(columns: readonly BoardColumn[]): readonly Phase[] {
  const phases: { bracket: StageBracket; columns: BoardColumn[] }[] = [];
  for (const column of columns) {
    const open = phases.at(-1);
    if (open?.bracket === column.stage.bracket) open.columns.push(column);
    else phases.push({ bracket: column.stage.bracket, columns: [column] });
  }
  return phases;
}

function Lanes(props: {
  readonly view: Shown;
  readonly viewer: CardViewer;
  readonly marks: Marks;
}) {
  const { view } = props;
  const firstKey = view.stages[0]?.key;
  return (
    <div class="flex items-start gap-6 overflow-x-auto pb-2">
      {phasesOf(view.columns).map((phase) => (
        <div
          role="group"
          aria-label={bracketText(phase.bracket)}
          data-phase={phase.bracket}
          class="flex shrink-0 flex-col gap-2"
        >
          <p
            aria-hidden="true"
            class="m-0 px-1 text-xs font-heavy tracking-wide text-text-3 uppercase"
          >
            {bracketText(phase.bracket)}
          </p>
          <div class="flex items-start gap-4">
            {phase.columns.map((column) => (
              <ColumnView
                view={view}
                column={column}
                first={column.stage.key === firstKey}
                viewer={props.viewer}
                marks={props.marks}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export async function oldQueueAddress(c: Context<AppEnv>): Promise<Response> {
  const screen = screenKernel(c);
  if (screen === null) return screenRefusal(c);
  const harnessId = idParam(c.req.param('harnessId'));
  if (harnessId === null) return notFound(c);
  const read = { at: screen.at };
  const scene = await screen.kernel.reads.harness(screen.caller, { harnessId }, read);
  if (scene.status !== 'accepted') return notFound(c);
  return c.redirect(queuePath(harnessId), 301);
}

export async function queueScreen(c: Context<AppEnv>): Promise<Response> {
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
  const marks = await cardMarks(screen, board, read);
  const tally = tallyOf(board);
  return renderScreen(
    c,
    specOf(view, cursor),
    <>
      <Head view={view} tally={tally} />
      <Toolbar tally={tally} />
      <StageChips view={view} stageKey={input.stageKey} />
      <EpicGroups harnessId={harnessId} epics={board.epics} />
      <NotReadyList harnessId={harnessId} entries={board.notReady} />
      <Lanes view={view} viewer={viewer} marks={marks} />
    </>,
  );
}
