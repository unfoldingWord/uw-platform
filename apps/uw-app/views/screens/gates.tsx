import type { Context } from 'hono';
import type { ShadowComparison } from '@uw/contracts';
import { formatCount } from '@uw/core/money';
import type { DelegatedMergeList, GateRow } from '@uw/harness';
import { Note } from '@uw/ui/components/note.tsx';
import { PageHead } from '@uw/ui/components/page-head.tsx';
import type { AppEnv } from '../../deps.ts';
import { ApproveAll, type Approvable } from '../parts/approve-all.tsx';
import { showsDecisions } from '../parts/decider.ts';
import { DelegatedMerges } from '../parts/delegated-merges.tsx';
import { renderScreen, screenKernel, screenRefusal, type ScreenKernel } from '../parts/frame.tsx';
import { parkedCapNote } from '../parts/caps.ts';
import { liveCursors } from '../parts/cursors.ts';
import { GatePanel, type GatePlace, type PanelGate } from '../parts/gate-panel.tsx';
import { HumanDot } from '@uw/ui/components/human-action.tsx';
import { formatDuration } from '@uw/core/dates';
import { gatePath, gatesPath, homePath } from '../parts/paths.ts';
import { ShadowList } from '../parts/shadow-list.tsx';
import { pageNames } from '../parts/names.ts';

const REFRESH_EVERY_MS = 60_000;
const focus = 'outline-offset-2 outline-accent-text focus-visible:outline-2';

type Shown = { readonly row: GateRow; readonly gate: PanelGate };

const BATCH_LIMIT = 50;

function approvableHead({ row, gate }: Shown): string | null {
  const advances = gate.view.ship?.outcome.verdict === 'advance';
  const ready = gate.decides && gate.ability.can && advances && !row.harness.shadow;
  return ready ? gate.view.expectedHead : null;
}

function approvable(shown: readonly Shown[]): readonly Approvable[] {
  const byHarness = new Map<string, Approvable>();
  for (const one of shown) {
    const head = approvableHead(one);
    if (head === null) continue;
    const { harness, item } = one.row;
    const held = byHarness.get(harness.id) ?? {
      harnessId: harness.id,
      harnessKey: harness.key,
      entries: [],
      total: 0,
    };
    byHarness.set(harness.id, {
      ...held,
      entries: [...held.entries, { itemId: item.itemId, head }],
      total: held.total + 1,
    });
  }
  return [...byHarness.values()].map((batch) => ({
    ...batch,
    entries: batch.entries.slice(0, BATCH_LIMIT),
  }));
}

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
    const place = placeOf(row, screen.at);
    shown.push({ row, gate: { view: view.value, title, ability, decides, place } });
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

export function placeOf(row: GateRow, at: Date): GatePlace {
  const { item } = row;
  const held = item.heldSince === null ? null : new Date(item.heldSince);
  return {
    harness: row.harness.title,
    stage: row.stage.title,
    number: item.issue === null ? null : `#${item.issue.number}`,
    waited: held === null ? null : formatDuration(Math.max(0, at.getTime() - held.getTime())),
  };
}

export function Inbox(props: {
  readonly rows: readonly GateRow[];
  readonly at: Date;
  readonly selected: string | null;
  readonly phone: 'shown' | 'hidden';
}) {
  return (
    <nav
      aria-label="Decisions"
      class={`min-w-0 flex-col gap-1 md:flex md:w-inbox md:shrink-0 ${props.phone === 'shown' ? 'flex' : 'hidden'}`}
    >
      <p class="m-0 px-2 pb-2 text-md font-heavy text-text">
        Decide <span class="font-mono text-sm font-regular text-text-3">{props.rows.length}</span>
      </p>
      <ul class="m-0 flex list-none flex-col gap-1 p-0">
        {props.rows.map((row) => {
          const place = placeOf(row, props.at);
          const current = row.item.itemId === props.selected;
          return (
            <li>
              <a
                href={gatePath(row.harness.id, row.item.itemId)}
                aria-current={current ? 'page' : undefined}
                class={`flex items-start gap-3 rounded-md px-2 py-3 hover:bg-hover aria-[current=page]:bg-raised aria-[current=page]:shadow-1 ${focus}`}
              >
                <HumanDot />
                <span class="min-w-0 flex-1">
                  <span class="flex items-baseline gap-2">
                    <span class="min-w-0 flex-1 truncate text-sm font-heavy text-text">
                      {row.item.title}
                    </span>
                    {place.waited === null ? null : (
                      <span class="font-mono text-xs text-text-3">{place.waited}</span>
                    )}
                  </span>
                  <span class="block truncate text-xs text-text-3">
                    {[place.number, row.harness.title, row.stage.title]
                      .filter((part) => part !== null)
                      .join(' · ')}
                  </span>
                </span>
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
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
  readonly merged: DelegatedMergeList;
};

function GatesBody(props: Body & { readonly at: Date }) {
  const { shown, capped, comparisons, merged } = props;
  const note = capped ? <Note>{parkedCapNote}</Note> : null;
  const lists = comparisons.map((comparison) => <ShadowList comparison={comparison} />);
  const first = shown[0];
  if (first === undefined) {
    return (
      <>
        <PageHead title={pageNames.waiting} />
        {note ?? <Note>No gate is waiting for you to decide.</Note>}
        {lists}
        <DelegatedMerges merged={merged} />
      </>
    );
  }
  return (
    <>
      <PageHead title={pageNames.waiting} lede={lede(shown.length, capped)} />
      {note}
      {approvable(shown).map((batch) => (
        <ApproveAll batch={batch} />
      ))}
      <div class="flex flex-col gap-5 md:flex-row md:items-start">
        <Inbox
          rows={shown.map(({ row }) => row)}
          at={props.at}
          selected={first.row.item.itemId}
          phone="shown"
        />
        <div class="hidden min-w-0 flex-1 md:block">
          <GatePanel gate={first.gate} />
        </div>
      </div>
      {lists}
      <DelegatedMerges merged={merged} />
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
  const merged = await screen.kernel.views.delegatedMerges(screen.caller, { at: screen.at });
  const harnesses = liveCursors(cursors, [
    ...shown.map(({ row }) => row.harness.id),
    ...comparisons.map((comparison) => comparison.harnessId),
  ]);
  const spec = {
    title: pageNames.waiting,
    current: gatesPath(),
    crumbs: [{ label: pageNames.home, href: homePath() }, { label: pageNames.waiting }],
    live: { screen: 'gates' as const, harnesses, refreshEveryMs: REFRESH_EVERY_MS },
  };
  return renderScreen(
    c,
    spec,
    <GatesBody
      shown={shown}
      capped={capped}
      comparisons={comparisons}
      merged={merged}
      at={screen.at}
    />,
  );
}
