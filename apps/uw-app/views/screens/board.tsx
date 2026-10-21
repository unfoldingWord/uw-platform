import type { Context } from 'hono';
import type { AgentPickup, ExitGate, Principal, Stage } from '@uw/contracts';
import { can } from '@uw/core/acl';
import type { BoardColumn, BoardInput, BoardView } from '@uw/harness';
import { Chip } from '@uw/ui/components/chip.tsx';
import { CommandForm, commandButton } from '@uw/ui/components/command-form.tsx';
import { TextField } from '@uw/ui/components/field.tsx';
import { Lane } from '@uw/ui/components/lane.tsx';
import { PageHead } from '@uw/ui/components/page-head.tsx';
import { cursorOf } from '../../commands/reads.ts';
import type { AppEnv } from '../../deps.ts';
import { BoardCardView, type CardViewer } from '../parts/board-card.tsx';
import { EpicGroups, NotReadyList } from '../parts/epic-board.tsx';
import { renderScreen, screenKernel, screenRefusal } from '../parts/frame.tsx';
import { itemsText } from '../parts/items-count.ts';
import { idParam } from '../parts/params.ts';
import { boardPath, flowPath, homePath } from '../parts/paths.ts';
import { notFound } from './not-found.tsx';

const focus = 'outline-offset-2 outline-focus focus-visible:outline-2';

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
}) {
  const { column, view } = props;
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
      facts={facts}
    >
      {column.cards.map((card) => (
        <BoardCardView
          harnessId={harnessId}
          card={card}
          column={column.cards}
          viewer={props.viewer}
        />
      ))}
      {column.next === null ? null : (
        <a
          href={`${boardPath(harnessId, stage.key)}&after=${encodeURIComponent(column.next)}`}
          class={`text-link underline ${focus}`}
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
    title: `${harness.key} board`,
    current: flowPath(harness.id),
    crumbs: [
      { label: 'Home', href: homePath() },
      { label: harness.key, href: flowPath(harness.id) },
      { label: 'Board' },
    ],
    live: { screen: 'board' as const, harnesses: [{ harnessId: harness.id, cursor }] },
  };
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
  return renderScreen(
    c,
    specOf(view, cursor),
    <>
      <PageHead
        eyebrow="Board"
        title={board.harness.key}
        actions={
          <a href={flowPath(harnessId)} class={`text-link underline ${focus}`}>
            Flow
          </a>
        }
      />
      <StageChips view={view} stageKey={input.stageKey} />
      <EpicGroups harnessId={harnessId} epics={board.epics} />
      <NotReadyList harnessId={harnessId} entries={board.notReady} />
      <div class="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        {board.columns.map((column) => (
          <ColumnView
            view={view}
            column={column}
            first={column.stage.key === firstKey}
            viewer={viewer}
          />
        ))}
      </div>
    </>,
  );
}
