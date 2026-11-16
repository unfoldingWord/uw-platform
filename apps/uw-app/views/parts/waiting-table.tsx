import type { GateView } from '@uw/contracts';
import { CommandForm } from '@uw/ui/components/command-form.tsx';
import { TextField } from '@uw/ui/components/field.tsx';
import { HumanActionButton } from '@uw/ui/components/human-action.tsx';
import { reasonText } from '@uw/ui/components/text.ts';
import { refusalsOf } from './gate-panel.tsx';
import type { Shown } from './gate-rows.tsx';
import { gatePath } from './paths.ts';
import { failingReasons, reasonsText } from './ship-input.tsx';

const focus = 'outline-offset-2 outline-accent-text focus-visible:outline-2';
const cell = 'border-b border-line px-3 py-2 align-top';
const head = 'border-b border-line px-3 py-2 text-left text-xs font-heavy uppercase text-text-3';

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

function Row(props: { readonly shown: Shown }) {
  const { row, gate } = props.shown;
  const number = gate.place?.number ?? null;
  return (
    <tr data-gate-row={row.item.itemId}>
      <td class={cell}>
        <a
          href={gatePath(row.harness.id, row.item.itemId)}
          class={`font-heavy text-text hover:text-accent-text hover:underline ${focus}`}
        >
          {row.item.title}
        </a>
        {number === null ? null : <span class="block font-mono text-xs text-text-3">{number}</span>}
      </td>
      <td class={cell}>{row.stage.title}</td>
      <td class={`${cell} text-sm text-text-3`}>{checksText(gate.view)}</td>
      <td class={`${cell} font-mono text-xs text-text-3`}>{gate.place?.waited ?? ''}</td>
      <td class={cell}>
        <Actions shown={props.shown} />
      </td>
    </tr>
  );
}

export function WaitingTable(props: { readonly shown: readonly Shown[] }) {
  return (
    <div class="overflow-x-auto rounded-md border border-line bg-surface">
      <table class="w-full border-collapse text-sm">
        <caption class="sr-only">Gates waiting for you to decide</caption>
        <thead>
          <tr>
            <th scope="col" class={head}>
              Item
            </th>
            <th scope="col" class={head}>
              Stage
            </th>
            <th scope="col" class={head}>
              Checks
            </th>
            <th scope="col" class={head}>
              Waiting
            </th>
            <th scope="col" class={head}>
              <span class="sr-only">Decide</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {props.shown.map((shown) => (
            <Row shown={shown} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
