import type { Child } from 'hono/jsx';
import type { GateView } from '@uw/contracts';
import { CommandForm } from '@uw/ui/components/command-form.tsx';
import { TextField } from '@uw/ui/components/field.tsx';
import { HumanActionButton } from '@uw/ui/components/human-action.tsx';
import { IconButton } from '@uw/ui/components/button.tsx';
import { Table, type Column } from '@uw/ui/components/table.tsx';
import { reasonText } from '@uw/ui/components/text.ts';
import { refusalsOf } from './gate-panel.tsx';
import type { Shown } from './gate-rows.tsx';
import { gatePath, waitingPath } from './paths.ts';
import { failingReasons, reasonsText } from './ship-input.tsx';

const focus = 'outline-offset-2 outline-accent-text focus-visible:outline-2';

function reviewsText(view: GateView): string | null {
  const count = view.ship?.input.approvals.length ?? 0;
  if (count === 0) return null;
  return count === 1 ? '1 review approves' : `${count} reviews approve`;
}

function checksText(view: GateView): string {
  if (view.ship === null) return 'A person signs off';
  const failing = failingReasons(view);
  const rules = failing.length === 0 ? 'Ship rules met' : reasonsText(failing);
  const reviews = reviewsText(view);
  return reviews === null ? rules : `${rules} · ${reviews}`;
}

function approveLabel(view: GateView): string {
  return view.ship === null ? 'Approve' : 'Approve merge';
}

function Actions(props: { readonly shown: Shown }) {
  const { view, ability, decides } = props.shown.gate;
  if (!decides) {
    const why = ability.can ? 'A person decides this gate' : reasonText(ability.reason);
    return (
      <span data-locked class="text-sm text-text-3">
        {why}
      </span>
    );
  }
  const refusals = refusalsOf(view, ability);
  const { itemId, harnessId } = view;
  return (
    <CommandForm harnessId={harnessId} command="decide" itemId={itemId}>
      <div class="flex min-w-0 flex-col gap-2">
        <input type="hidden" name="itemId" value={itemId} />
        {view.facts === null ? null : <input type="hidden" name="head" value={view.facts.head} />}
        <div class="flex flex-wrap items-center gap-2">
          <HumanActionButton
            itemId={itemId}
            label={approveLabel(view)}
            name="decision"
            value="approve"
            disabledReason={refusals.approve}
          />
          <HumanActionButton
            itemId={itemId}
            label="Send back"
            name="decision"
            value="reject"
            disabledReason={refusals.reject}
          />
        </div>
        <TextField name="findings" label="Reason (optional)" scope={itemId} maxLength={2_000} />
      </div>
    </CommandForm>
  );
}

const columns: readonly Column[] = [
  { key: 'item', label: 'Item' },
  { key: 'stage', label: 'Stage' },
  { key: 'checks', label: 'Checks' },
  { key: 'waiting', label: 'Waiting', numeric: true },
  { key: 'decide', label: 'Decide' },
];

function peekPath(shown: Shown): string {
  const { harness, item } = shown.row;
  return `${waitingPath(harness.id)}?peek=${encodeURIComponent(item.itemId)}`;
}

function ItemCell(props: { readonly shown: Shown; readonly selected: boolean }) {
  const { row, gate } = props.shown;
  const number = gate.place?.number ?? null;
  return (
    <span class="flex min-w-0 items-start gap-2">
      <span class="min-w-0 flex-1">
        <a
          href={gatePath(row.harness.id, row.item.itemId)}
          aria-current={props.selected ? 'true' : undefined}
          class={`font-semibold text-text no-underline hover:text-accent-text hover:underline aria-[current=true]:text-accent-text aria-[current=true]:underline ${focus}`}
        >
          {row.item.title}
        </a>
        {number === null ? null : <span class="block font-mono text-xs text-text-3">{number}</span>}
      </span>
      {props.selected ? null : (
        <IconButton
          icon="file-lines"
          label={`Preview ${row.item.title} beside the list`}
          size="sm"
          href={peekPath(props.shown)}
        />
      )}
    </span>
  );
}

function rowOf(shown: Shown, peek: string | null): Readonly<Record<string, Child>> {
  const { row, gate } = shown;
  return {
    item: <ItemCell shown={shown} selected={row.item.itemId === peek} />,
    stage: row.stage.title,
    checks: <span class="text-text-3">{checksText(gate.view)}</span>,
    waiting: gate.place?.waited ?? '',
    decide: <Actions shown={shown} />,
  };
}

export function WaitingTable(props: {
  readonly shown: readonly Shown[];
  readonly peek?: string | null | undefined;
}) {
  const peek = props.peek ?? null;
  return (
    <Table
      caption="Gates waiting for you to decide"
      columns={columns}
      rows={props.shown.map((shown) => rowOf(shown, peek))}
      selected={props.shown.findIndex((shown) => shown.row.item.itemId === peek)}
    />
  );
}
