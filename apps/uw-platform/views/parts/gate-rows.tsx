import { formatDuration } from '@uw/core/dates';
import type { GateRow } from '@uw/harness';
import { HumanDot, humanBadge } from '@uw/ui/components/human-action.tsx';
import { SectionHeading } from '@uw/ui/components/section.tsx';
import type { Approvable } from './approve-all.tsx';
import { showsDecisions } from './decider.ts';
import type { ScreenKernel } from './frame.tsx';
import type { GatePlace, PanelGate } from './gate-panel.tsx';
import { gatePath } from './paths.ts';

export type Shown = { readonly row: GateRow; readonly gate: PanelGate };

const BATCH_LIMIT = 50;
const focus = 'outline-offset-2 outline-accent-text focus-visible:outline-2';

function approvableHead({ row, gate }: Shown): string | null {
  const advances = gate.view.ship?.outcome.verdict === 'advance';
  const ready = gate.decides && gate.ability.can && advances && !row.harness.shadow;
  return ready ? gate.view.expectedHead : null;
}

export function approvable(shown: readonly Shown[]): readonly Approvable[] {
  const byHarness = new Map<string, Approvable>();
  for (const one of shown) {
    const head = approvableHead(one);
    if (head === null) continue;
    const { harness, item } = one.row;
    const held = byHarness.get(harness.id) ?? {
      harnessId: harness.id,
      harnessTitle: harness.title,
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

export function placeOf(row: Pick<GateRow, 'item' | 'harness' | 'stage'>, at: Date): GatePlace {
  const { item } = row;
  const held = item.heldSince === null ? null : new Date(item.heldSince);
  return {
    harness: row.harness.title,
    stage: row.stage.title,
    number: item.issue === null ? null : `#${item.issue.number}`,
    waited: held === null ? null : formatDuration(Math.max(0, at.getTime() - held.getTime())),
  };
}

export async function panelsOf(screen: ScreenKernel, rows: readonly GateRow[]): Promise<Shown[]> {
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

function InboxHead(props: { readonly count: number }) {
  return (
    <SectionHeading
      id="decisions-heading"
      title="Decide"
      sub={
        <span class={`rounded-sm px-1 font-mono text-xs leading-normal ${humanBadge}`}>
          {props.count}
        </span>
      }
    />
  );
}

function InboxEntry(props: {
  readonly row: GateRow;
  readonly at: Date;
  readonly current: boolean;
}) {
  const { row } = props;
  const place = placeOf(row, props.at);
  return (
    <li>
      <a
        href={gatePath(row.harness.id, row.item.itemId)}
        aria-current={props.current ? 'page' : undefined}
        class={`flex items-start gap-3 rounded-md px-2 py-2 no-underline transition-colors motion-reveal hover:bg-raised aria-[current=page]:bg-accent-soft ${focus}`}
      >
        <HumanDot />
        <span class="min-w-0 flex-1">
          <span class="flex items-baseline gap-2">
            <span class="min-w-0 flex-1 truncate text-sm font-semibold text-text">
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
      class={`min-w-0 flex-col gap-3 md:flex ${props.phone === 'shown' ? 'flex' : 'hidden'}`}
    >
      <InboxHead count={props.rows.length} />
      {props.rows.length === 0 ? (
        <p class="m-0 text-sm text-text-3">
          No gate in this workflow is waiting for you to decide.
        </p>
      ) : null}
      <ul class="-mx-2 m-0 flex list-none flex-col gap-1 p-0">
        {props.rows.map((row) => (
          <InboxEntry row={row} at={props.at} current={row.item.itemId === props.selected} />
        ))}
      </ul>
    </nav>
  );
}
