import type { Context } from 'hono';
import { formatInstant } from '@uw/core/dates';
import { formatCount } from '@uw/core/money';
import { FAILED_RUNS_LIMIT, type WaitingRow } from '@uw/harness';
import { commandButton } from '@uw/ui/components/command-form.tsx';
import { Note } from '@uw/ui/components/note.tsx';
import { PageHead } from '@uw/ui/components/page-head.tsx';
import { reasonText } from '@uw/ui/components/text.ts';
import type { AppEnv } from '../../deps.ts';
import { handedCapNote, lapsedCapNote, parkedCapNote } from '../parts/caps.ts';
import { liveCursors } from '../parts/cursors.ts';
import { renderScreen, screenKernel, screenRefusal } from '../parts/frame.tsx';
import { flowPath, gatePath, homePath, itemPath } from '../parts/paths.ts';

const REFRESH_EVERY_MS = 60_000;
const focus = 'outline-offset-2 outline-focus focus-visible:outline-2';

type Shown = { readonly href: string; readonly text: string; readonly harnessId: string };

function lapsedText(
  row: Extract<WaitingRow, { kind: 'delegation_lapsed' }>,
  viewer: string | null,
): string {
  const { harness, delegation } = row;
  const lapsed = formatInstant(delegation.lapsedAt ?? delegation.expiresAt);
  if (delegation.personId === viewer) {
    return `Your delegation to ${delegation.persona} on ${harness.key} lapsed ${lapsed}`;
  }
  return `A delegation to ${delegation.persona} on ${harness.key} lapsed ${lapsed} because its person no longer holds admin`;
}

const roundWords: ReadonlyMap<number, string> = new Map([[3, 'three']]);

function roundsText(rounds: number): string {
  return roundWords.get(rounds) ?? formatCount(rounds);
}

function shown(row: WaitingRow, viewer: string | null): Shown {
  if (row.kind === 'gate') {
    const { harness, stage, item } = row.gate;
    return {
      href: gatePath(harness.id, item.itemId),
      text: `Decide ${item.title} at ${stage.title}`,
      harnessId: harness.id,
    };
  }
  if (row.kind === 'delegation_lapsed') {
    return {
      href: flowPath(row.harness.id),
      text: lapsedText(row, viewer),
      harnessId: row.harness.id,
    };
  }
  if (row.kind === 'handed_to_person') {
    return {
      href: itemPath(row.harness.id, row.item.itemId),
      text: `${row.item.title} was handed to you after ${roundsText(row.rounds)} review rounds`,
      harnessId: row.harness.id,
    };
  }
  const why = reasonText(row.run.failure ?? 'run_failed');
  return {
    href: itemPath(row.harness.id, row.item.itemId),
    text: `A run failed on ${row.item.title}: ${why}`,
    harnessId: row.harness.id,
  };
}

function lede(count: number, capped: boolean): string {
  if (capped) return `At least ${formatCount(count)} things are waiting on you`;
  return count === 1
    ? '1 thing is waiting on you'
    : `${formatCount(count)} things are waiting on you`;
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

function WaitingList(props: { readonly rows: readonly Shown[] }) {
  return (
    <ul class="m-0 flex list-none flex-col gap-2 p-0">
      {props.rows.map((row) => (
        <li class="rounded-md border border-line bg-surface p-3">
          <a href={row.href} class={`text-link underline ${focus}`}>
            {row.text}
          </a>
        </li>
      ))}
    </ul>
  );
}

function PushControl() {
  return (
    <section data-push aria-labelledby="push-heading" class="mt-6 flex flex-col gap-2">
      <h2 id="push-heading" class="m-0 text-base font-bold text-ink">
        Notifications
      </h2>
      <div>
        <button type="button" data-push-toggle class={commandButton}>
          Turn on notifications on this device
        </button>
      </div>
      <p data-push-outcome role="status" class="m-0 text-sm text-muted"></p>
    </section>
  );
}

export async function homeScreen(c: Context<AppEnv>): Promise<Response> {
  const screen = screenKernel(c);
  if (screen === null) return screenRefusal(c);
  const cursors = await screen.kernel.views.cursors(screen.caller, { at: screen.at });
  const waiting = await screen.kernel.views.waitingOn(screen.caller, { at: screen.at });
  const rows = waiting.rows.map((row) => shown(row, screen.caller.actor.personId));
  const notes = capNotes(waiting);
  const harnesses = liveCursors(
    cursors,
    rows.map((row) => row.harnessId),
  );
  const spec = {
    title: 'Home',
    current: homePath(),
    crumbs: [{ label: 'Home' }],
    live: { screen: 'home' as const, harnesses, refreshEveryMs: REFRESH_EVERY_MS },
  };
  return renderScreen(
    c,
    spec,
    rows.length === 0 && notes.length === 0 ? (
      <>
        <PageHead title="Waiting on you" />
        <Note>Nothing is waiting on you right now.</Note>
        <PushControl />
      </>
    ) : (
      <>
        <PageHead
          title="Waiting on you"
          {...(rows.length === 0 ? {} : { lede: lede(rows.length, notes.length > 0) })}
        />
        {notes.map((note) => (
          <Note>{note}</Note>
        ))}
        {rows.length === 0 ? null : <WaitingList rows={rows} />}
        <PushControl />
      </>
    ),
  );
}
