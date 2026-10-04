import type { Context } from 'hono';
import { formatInstant } from '@uw/core/dates';
import { formatCount } from '@uw/core/money';
import { FAILED_RUNS_LIMIT, type WaitingRow } from '@uw/harness';
import { Note } from '@uw/ui/components/note.tsx';
import { PageHead } from '@uw/ui/components/page-head.tsx';
import { reasonText } from '@uw/ui/components/text.ts';
import type { AppEnv } from '../../deps.ts';
import { liveCursors } from '../parts/cursors.ts';
import { renderScreen, screenKernel, screenRefusal } from '../parts/frame.tsx';
import { flowPath, gatePath, homePath, itemPath } from '../parts/paths.ts';

const REFRESH_EVERY_MS = 60_000;
const focus = 'outline-offset-2 outline-focus focus-visible:outline-2';

type Shown = { readonly href: string; readonly text: string; readonly harnessId: string };

function shown(row: WaitingRow): Shown {
  if (row.kind === 'gate') {
    const { harness, stage, item } = row.gate;
    return {
      href: gatePath(harness.id, item.itemId),
      text: `Decide ${item.title} at ${stage.title}`,
      harnessId: harness.id,
    };
  }
  if (row.kind === 'delegation_lapsed') {
    const { harness, delegation } = row;
    const lapsed = formatInstant(delegation.lapsedAt ?? delegation.expiresAt);
    return {
      href: flowPath(harness.id),
      text: `Your delegation to ${delegation.persona} on ${harness.key} lapsed ${lapsed}`,
      harnessId: harness.id,
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

export async function homeScreen(c: Context<AppEnv>): Promise<Response> {
  const screen = screenKernel(c);
  if (screen === null) return screenRefusal(c);
  const cursors = await screen.kernel.views.cursors(screen.caller, { at: screen.at });
  const waiting = await screen.kernel.views.waitingOn(screen.caller, { at: screen.at });
  const rows = waiting.rows.map(shown);
  const harnesses = liveCursors(
    cursors,
    rows.map((row) => row.harnessId),
  );
  const spec = {
    title: 'Home',
    current: homePath(),
    crumbs: [{ label: 'Home' }],
    live: { harnesses, refreshEveryMs: REFRESH_EVERY_MS },
  };
  return renderScreen(
    c,
    spec,
    rows.length === 0 ? (
      <>
        <PageHead title="Waiting on you" />
        <Note>Nothing is waiting on you right now.</Note>
      </>
    ) : (
      <>
        <PageHead title="Waiting on you" lede={lede(rows.length, waiting.failedRunsCapped)} />
        {waiting.failedRunsCapped ? <Note>{cappedNote}</Note> : null}
        <WaitingList rows={rows} />
      </>
    ),
  );
}
