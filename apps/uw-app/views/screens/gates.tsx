import type { Context } from 'hono';
import { formatCount } from '@uw/core/money';
import type { GateRow } from '@uw/harness';
import { Note } from '@uw/ui/components/note.tsx';
import { PageHead } from '@uw/ui/components/page-head.tsx';
import type { AppEnv } from '../../deps.ts';
import { showsDecisions } from '../parts/decider.ts';
import { renderScreen, screenKernel, screenRefusal, type ScreenKernel } from '../parts/frame.tsx';
import { parkedCapNote } from '../parts/caps.ts';
import { liveCursors } from '../parts/cursors.ts';
import { GatePanel, type PanelGate } from '../parts/gate-panel.tsx';
import { gatePath, gatesPath, homePath } from '../parts/paths.ts';

const REFRESH_EVERY_MS = 60_000;
const focus = 'outline-offset-2 outline-focus focus-visible:outline-2';

type Shown = { readonly row: GateRow; readonly gate: PanelGate };

async function panelsOf(screen: ScreenKernel, rows: readonly GateRow[]): Promise<Shown[]> {
  const shown: Shown[] = [];
  const read = { at: screen.at };
  for (const row of rows) {
    const { itemId } = row.item;
    const view = await screen.kernel.views.gate(screen.caller, { itemId }, read);
    if (view.status !== 'accepted') continue;
    const ability = screen.kernel.views.decideAbility(screen.caller, row, read);
    const title = `${row.item.title} at ${row.stage.title}`;
    const decides = showsDecisions(screen.caller.actor, ability);
    shown.push({ row, gate: { view: view.value, title, ability, decides } });
  }
  return shown;
}

function lede(count: number, capped: boolean): string {
  const counted =
    count === 1
      ? '1 gate is waiting for you to decide'
      : `${formatCount(count)} gates are waiting for you to decide`;
  return capped ? `At least ${counted}` : counted;
}

function GateList(props: { readonly shown: readonly Shown[] }) {
  return (
    <div class="flex flex-col gap-6">
      {props.shown.map(({ row, gate }) => (
        <div class="flex flex-col gap-2">
          <p class="m-0">
            <a
              href={gatePath(row.harness.id, row.item.itemId)}
              class={`text-link underline ${focus}`}
            >
              {`Open ${row.item.title} on ${row.harness.key}`}
            </a>
          </p>
          <GatePanel gate={gate} />
        </div>
      ))}
    </div>
  );
}

export async function gatesScreen(c: Context<AppEnv>): Promise<Response> {
  const screen = screenKernel(c);
  if (screen === null) return screenRefusal(c);
  const cursors = await screen.kernel.views.cursors(screen.caller, { at: screen.at });
  const { rows, capped } = await screen.kernel.views.gates(screen.caller, { at: screen.at });
  const shown = await panelsOf(screen, rows);
  const note = capped ? <Note>{parkedCapNote}</Note> : null;
  const harnesses = liveCursors(
    cursors,
    shown.map(({ row }) => row.harness.id),
  );
  const spec = {
    title: 'Gates',
    current: gatesPath(),
    crumbs: [{ label: 'Home', href: homePath() }, { label: 'Gates' }],
    live: { harnesses, refreshEveryMs: REFRESH_EVERY_MS },
  };
  return renderScreen(
    c,
    spec,
    shown.length === 0 ? (
      <>
        <PageHead title="Gates" />
        {note ?? <Note>No gate is waiting for you to decide.</Note>}
      </>
    ) : (
      <>
        <PageHead title="Gates" lede={lede(shown.length, capped)} />
        {note}
        <GateList shown={shown} />
      </>
    ),
  );
}
