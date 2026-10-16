import type { Context } from 'hono';
import type { ShadowComparison } from '@uw/contracts';
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
import { ShadowList } from '../parts/shadow-list.tsx';

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

async function shadowComparisons(screen: ScreenKernel): Promise<ShadowComparison[]> {
  const read = { at: screen.at };
  const shown: ShadowComparison[] = [];
  for (const harness of await screen.kernel.views.harnesses(screen.caller, read)) {
    if (!harness.shadow) continue;
    const comparison = await screen.kernel.views.shadow(
      screen.caller,
      { harnessId: harness.id },
      read,
    );
    if (comparison.status === 'accepted') shown.push(comparison.value);
  }
  return shown;
}

type Body = {
  readonly shown: readonly Shown[];
  readonly capped: boolean;
  readonly comparisons: readonly ShadowComparison[];
};

function GatesBody(props: Body) {
  const { shown, capped, comparisons } = props;
  const note = capped ? <Note>{parkedCapNote}</Note> : null;
  const lists = comparisons.map((comparison) => <ShadowList comparison={comparison} />);
  if (shown.length === 0) {
    return (
      <>
        <PageHead title="Gates" />
        {note ?? <Note>No gate is waiting for you to decide.</Note>}
        {lists}
      </>
    );
  }
  return (
    <>
      <PageHead title="Gates" lede={lede(shown.length, capped)} />
      {note}
      <GateList shown={shown} />
      {lists}
    </>
  );
}

export async function gatesScreen(c: Context<AppEnv>): Promise<Response> {
  const screen = screenKernel(c);
  if (screen === null) return screenRefusal(c);
  const cursors = await screen.kernel.views.cursors(screen.caller, { at: screen.at });
  const { rows, capped } = await screen.kernel.views.gates(screen.caller, { at: screen.at });
  const shown = await panelsOf(screen, rows);
  const comparisons = await shadowComparisons(screen);
  const harnesses = liveCursors(cursors, [
    ...shown.map(({ row }) => row.harness.id),
    ...comparisons.map((comparison) => comparison.harnessId),
  ]);
  const spec = {
    title: 'Gates',
    current: gatesPath(),
    crumbs: [{ label: 'Home', href: homePath() }, { label: 'Gates' }],
    live: { screen: 'gates' as const, harnesses, refreshEveryMs: REFRESH_EVERY_MS },
  };
  return renderScreen(
    c,
    spec,
    <GatesBody shown={shown} capped={capped} comparisons={comparisons} />,
  );
}
