import type { Context } from 'hono';
import { formatDate, formatInstant } from '@uw/core/dates';
import { formatCount } from '@uw/core/money';
import { FAILED_RUNS_LIMIT, type FlowView, type WaitingRow } from '@uw/harness';
import { Badge } from '@uw/ui/components/badge.tsx';
import { Card } from '@uw/ui/components/card.tsx';
import { Sparkline } from '@uw/ui/components/chart.tsx';
import { HumanTile, humanBar } from '@uw/ui/components/human-action.tsx';
import { Icon } from '@uw/ui/components/icon.tsx';
import type { IconName } from '@uw/ui/generated/icons';
import { commandButton } from '@uw/ui/components/command-form.tsx';
import { Note } from '@uw/ui/components/note.tsx';
import { PageHead } from '@uw/ui/components/page-head.tsx';
import { reasonText } from '@uw/ui/components/text.ts';
import type { AppEnv } from '../../deps.ts';
import { handedCapNote, lapsedCapNote, parkedCapNote } from '../parts/caps.ts';
import { liveCursors } from '../parts/cursors.ts';
import { renderScreen, screenKernel, screenRefusal, type ScreenKernel } from '../parts/frame.tsx';
import { boardPath, flowPath, gatePath, homePath, itemPath } from '../parts/paths.ts';
import { moduleCodes } from '../parts/names.ts';
import { pageNames } from '../parts/names.ts';

const REFRESH_EVERY_MS = 60_000;

function personName(email: string | null): string | null {
  const first = (email ?? '').split('@')[0]?.split(/[._-]+/)[0] ?? '';
  return first === '' ? null : first.charAt(0).toUpperCase() + first.slice(1);
}

function greeting(name: string | null): string {
  return name === null ? 'Hello' : `Hello, ${name}`;
}
const focus = 'outline-offset-2 outline-accent-text focus-visible:outline-2';

type Shown = {
  readonly href: string;
  readonly text: string;
  readonly harnessId: string;
  readonly kind: WaitingRow['kind'];
  readonly sub: string;
};

function lapsedText(
  row: Extract<WaitingRow, { kind: 'delegation_lapsed' }>,
  viewer: string | null,
): string {
  const { harness, delegation } = row;
  const lapsed = formatInstant(delegation.lapsedAt ?? delegation.expiresAt);
  if (delegation.personId === viewer) {
    return `Your delegation to ${delegation.persona} on ${harness.title} lapsed ${lapsed}`;
  }
  return `A delegation to ${delegation.persona} on ${harness.title} lapsed ${lapsed} because its person no longer holds admin`;
}

const roundWords: ReadonlyMap<number, string> = new Map([[3, 'three']]);

function roundsText(rounds: number): string {
  return roundWords.get(rounds) ?? formatCount(rounds);
}

function numberOf(item: { readonly issue: { readonly number: number } | null }): number | null {
  return item.issue === null ? null : item.issue.number;
}

function subOf(harness: string, number: number | null): string {
  return number === null ? harness : `${harness} · #${number}`;
}

function shown(row: WaitingRow, viewer: string | null): Shown {
  if (row.kind === 'gate') {
    const { harness, stage, item } = row.gate;
    return {
      href: gatePath(harness.id, item.itemId),
      text: `Decide ${item.title} at ${stage.title}`,
      harnessId: harness.id,
      kind: row.kind,
      sub: subOf(harness.title, numberOf(item)),
    };
  }
  if (row.kind === 'delegation_lapsed') {
    return {
      href: flowPath(row.harness.id),
      text: lapsedText(row, viewer),
      harnessId: row.harness.id,
      kind: row.kind,
      sub: `${row.delegation.persona} can't act for you until you delegate again`,
    };
  }
  if (row.kind === 'handed_to_person') {
    return {
      href: itemPath(row.harness.id, row.item.itemId),
      text:
        row.rounds === null
          ? `${row.item.title} was handed to you because an engine refused it`
          : `${row.item.title} was handed to you after ${roundsText(row.rounds)} review rounds`,
      harnessId: row.harness.id,
      kind: row.kind,
      sub: subOf(row.harness.title, numberOf(row.item)),
    };
  }
  const why = reasonText(row.run.failure ?? 'run_failed');
  return {
    href: itemPath(row.harness.id, row.item.itemId),
    text: `A run failed on ${row.item.title}: ${why}`,
    harnessId: row.harness.id,
    kind: row.kind,
    sub: subOf(row.harness.title, numberOf(row.item)),
  };
}

function countWords(count: number, capped: boolean): string {
  if (capped) return `At least ${formatCount(count)} things are waiting on you`;
  return count === 1
    ? '1 thing is waiting on you'
    : `${formatCount(count)} things are waiting on you`;
}

function lede(count: number, capped: boolean, uncounted: number): string {
  const head = countWords(count, capped);
  if (uncounted === 0) return head;
  return `${head}, not counting ${formatCount(uncounted)} on pull requests by bot accounts`;
}

const cappedNote = `At least ${formatCount(FAILED_RUNS_LIMIT)} runs failed on your items in the last 7 days. The newest ${formatCount(FAILED_RUNS_LIMIT)} are listed.`;

type Caps = {
  readonly failedRunsCapped: boolean;
  readonly gatesCapped: boolean;
  readonly lapsedCapped: boolean;
  readonly handedCapped: boolean;
};

function capNotes(waiting: Caps): readonly string[] {
  const notes: string[] = [];
  if (waiting.failedRunsCapped) notes.push(cappedNote);
  if (waiting.gatesCapped) notes.push(parkedCapNote);
  if (waiting.lapsedCapped) notes.push(lapsedCapNote);
  if (waiting.handedCapped) notes.push(handedCapNote);
  return notes;
}

const tileIcons = new Map<WaitingRow['kind'], IconName>([
  ['handed_to_person', 'robot'],
  ['run_failed', 'robot'],
  ['delegation_lapsed', 'clock'],
]);

function Tile(props: { readonly kind: WaitingRow['kind'] }) {
  if (props.kind === 'gate') return <HumanTile />;
  return (
    <span class="grid size-size-5 shrink-0 place-items-center rounded-md bg-raised text-text-2">
      <Icon name={tileIcons.get(props.kind) ?? 'circle-dot'} size={2} />
    </span>
  );
}

function WaitingList(props: { readonly rows: readonly Shown[] }) {
  return (
    <ul aria-label="Waiting on you" class="m-0 flex list-none flex-col gap-2 p-0">
      {props.rows.map((row) => (
        <li class="flex items-center gap-3 rounded-md border border-line px-3 py-2">
          <Tile kind={row.kind} />
          <div class="min-w-0 flex-1">
            <a
              href={row.href}
              class={`text-sm font-heavy text-text underline-offset-2 hover:underline ${focus}`}
            >
              {row.text}
            </a>
            <p class="m-0 text-xs text-text-3">{row.sub}</p>
          </div>
          <span
            aria-hidden="true"
            class="rounded-md border border-line px-2 text-xs leading-normal font-heavy text-text-3"
          >
            Open
          </span>
        </li>
      ))}
    </ul>
  );
}

function WaitingCard(props: {
  readonly rows: readonly Shown[];
  readonly notes: readonly string[];
}) {
  const count = props.rows.length;
  return (
    <Card
      title="Waiting on you"
      sub={count === 0 ? undefined : <Badge tone="person">{`${formatCount(count)} waiting`}</Badge>}
      actions={<span class="text-xs text-text-3">an agent cannot advance these</span>}
    >
      {props.notes.map((note) => (
        <Note>{note}</Note>
      ))}
      {count === 0 && props.notes.length === 0 ? (
        <Note>Nothing is waiting on you right now.</Note>
      ) : null}
      {count === 0 ? null : <WaitingList rows={props.rows} />}
    </Card>
  );
}

function Soon(props: { readonly title: string }) {
  return (
    <div aria-disabled="true" class="flex cursor-default flex-col opacity-45">
      <Card title={props.title}>
        <p class="m-0 text-sm text-text-3">Not built yet.</p>
      </Card>
    </div>
  );
}

type WorkflowCard = {
  readonly flow: FlowView;
  readonly runs: readonly number[];
  readonly waiting: number;
};

function StageBars(props: { readonly flow: FlowView }) {
  const most = Math.max(1, ...props.flow.stages.map((stage) => stage.count));
  const height = (count: number): string => {
    if (count === 0) return 'h-size-1';
    return count * 2 >= most ? 'h-size-5' : 'h-size-3';
  };
  return (
    <ol aria-label="Items by stage" class="m-0 flex h-size-5 list-none items-end gap-1 p-0">
      {props.flow.stages.map(({ stage, count }) => (
        <li
          title={`${stage.title}: ${count}`}
          class={`flex-1 rounded-sm ${height(count)} ${stage.exitGate === 'human_approval' ? humanBar : 'bg-accent'}`}
        >
          <span class="sr-only">{`${stage.title}: ${count}`}</span>
        </li>
      ))}
    </ol>
  );
}

function HarnessCard(props: { readonly card: WorkflowCard }) {
  const { flow, runs, waiting } = props.card;
  const items = flow.stages.reduce((sum, stage) => sum + stage.count, 0);
  const moving = flow.stages.reduce((sum, stage) => sum + stage.held, 0);
  return (
    <li class="flex flex-col gap-3 border-b border-line-soft px-4 py-3 last:border-b-0">
      <div class="flex flex-wrap items-center gap-2">
        <a href={boardPath(flow.harness.id)} class={`text-base font-heavy text-text ${focus}`}>
          {flow.harness.title}
        </a>
        <span class="text-xs text-text-3">{`${flow.harness.template} template`}</span>
      </div>
      <StageBars flow={flow} />
      <div>
        <p class="m-0 mb-1 text-xs text-text-3">{`Runs, ${runs.length} days · ${formatCount(runs.reduce((a, b) => a + b, 0))}`}</p>
        <Sparkline
          id={`spark-${flow.harness.key}`}
          label={`Runs per day on ${flow.harness.title}`}
          values={runs}
        />
      </div>
      <p class="m-0 flex flex-wrap gap-x-4 text-xs text-text-3">
        <span>{`${formatCount(items)} items`}</span>
        <span>{`${formatCount(moving)} in progress`}</span>
        <span>{`${formatCount(waiting)} waiting on you`}</span>
      </p>
    </li>
  );
}

function HarnessCards(props: { readonly cards: readonly WorkflowCard[] }) {
  if (props.cards.length === 0) return null;
  return (
    <section
      aria-labelledby="harnesses-heading"
      class="flex min-w-0 flex-col rounded-md border border-line bg-surface"
    >
      <div class="flex items-center gap-2 border-b border-line px-4 py-3">
        <h2 id="harnesses-heading" class="m-0 text-md font-heavy text-text">
          Workflows
        </h2>
        <span class="text-xs font-semibold text-text-3">{`${formatCount(props.cards.length)} in Agent Queues`}</span>
      </div>
      <ul class="m-0 flex list-none flex-col p-0">
        {props.cards.map((card) => (
          <HarnessCard card={card} />
        ))}
      </ul>
      <PushControl />
    </section>
  );
}

async function cardsOf(
  screen: ScreenKernel,
  waiting: readonly WaitingRow[],
): Promise<WorkflowCard[]> {
  const read = { at: screen.at };
  const cards: WorkflowCard[] = [];
  for (const harness of await screen.kernel.views.harnesses(screen.caller, read)) {
    const flow = await screen.kernel.views.flow(screen.caller, { harnessId: harness.id }, read);
    if (flow.status !== 'accepted') continue;
    const days = await screen.kernel.views.daily(screen.caller, { harnessId: harness.id }, read);
    const gates = waiting.filter(
      (row) => row.kind === 'gate' && row.gate.harness.id === harness.id,
    );
    cards.push({ flow: flow.value, runs: days.map((day) => day.runs), waiting: gates.length });
  }
  return cards;
}

function PushControl() {
  return (
    <section
      data-push
      aria-labelledby="push-heading"
      class="flex flex-wrap items-center gap-3 border-t border-dashed border-line px-4 py-2"
    >
      <Icon name="inbox" size={1} class="text-text-3" />
      <h3 id="push-heading" class="m-0 text-sm font-heavy text-text">
        Notifications
      </h3>
      <button type="button" data-push-toggle class={commandButton}>
        Turn on notifications on this device
      </button>
      <p data-push-outcome role="status" class="m-0 text-sm text-text-3"></p>
    </section>
  );
}

function PushOnly() {
  return (
    <div class="flex min-w-0 flex-col rounded-md border border-line bg-surface">
      <PushControl />
    </div>
  );
}

export async function homeScreen(c: Context<AppEnv>): Promise<Response> {
  const screen = screenKernel(c);
  if (screen === null) return screenRefusal(c);
  const cursors = await screen.kernel.views.cursors(screen.caller, { at: screen.at });
  const waiting = await screen.kernel.views.waitingOn(screen.caller, { at: screen.at });
  const rows = waiting.rows.map((row) => shown(row, screen.caller.actor.personId));
  const notes = capNotes(waiting);
  const cards = await cardsOf(screen, waiting.rows);
  const person = personName(screen.caller.actor.email);
  const harnesses = liveCursors(
    cursors,
    rows.map((row) => row.harnessId),
  );
  const spec = {
    title: pageNames.home,
    current: homePath(),
    code: moduleCodes.today,
    crumbs: [{ label: pageNames.home }],
    live: { screen: 'home' as const, harnesses, refreshEveryMs: REFRESH_EVERY_MS },
  };
  const head =
    rows.length === 0
      ? {}
      : { lede: lede(rows.length - waiting.uncounted, notes.length > 0, waiting.uncounted) };
  return renderScreen(
    c,
    spec,
    <>
      <PageHead eyebrow={`Today · ${formatDate(screen.at)}`} title={greeting(person)} {...head} />
      <div class="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <WaitingCard rows={rows} notes={notes} />
        <Soon title="Your tasks" />
        {cards.length === 0 ? <PushOnly /> : <HarnessCards cards={cards} />}
        <Soon title="Activity" />
      </div>
    </>,
  );
}
