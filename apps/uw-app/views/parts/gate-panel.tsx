import type { GateView } from '@uw/contracts';
import type { DecideAbility } from '@uw/harness';
import { CommandForm } from '@uw/ui/components/command-form.tsx';
import { TextAreaField, TextField } from '@uw/ui/components/field.tsx';
import { GateCallout, GateFacts } from '@uw/ui/components/gate-callout.tsx';
import { HumanActionButton } from '@uw/ui/components/human-action.tsx';
import { reasonText } from '@uw/ui/components/text.ts';
import { failingReasons, reasonsText, ShipInput } from './ship-input.tsx';

export type PanelGate = {
  readonly view: GateView;
  readonly title: string;
  readonly ability: DecideAbility;
  readonly decides: boolean;
};

type Refusals = {
  readonly approve: string | null;
  readonly reject: string | null;
  readonly take_over: string | null;
  readonly override: string | null;
};

function refusalsOf(view: GateView, ability: DecideAbility): Refusals {
  if (!ability.can) {
    const reason = reasonText(ability.reason);
    return { approve: reason, reject: reason, take_over: reason, override: reason };
  }
  const failing = failingReasons(view);
  const onlyApproval = failing.every((reason) => reason === 'no_reviewer_approval');
  return {
    approve: failing.length === 0 ? null : reasonsText(failing),
    reject: null,
    take_over: null,
    override: onlyApproval ? null : reasonsText(failing),
  };
}

function providersOf(view: GateView): readonly string[] {
  const providers = (view.ship?.input.approvals ?? []).flatMap((approval) =>
    approval.provider === null ? [] : [approval.provider],
  );
  return [...new Set(providers)];
}

function Facts(props: { readonly view: GateView }) {
  const { view } = props;
  return (
    <div class="flex flex-col gap-4 md:flex-row">
      <div class="min-w-0 flex-1">
        <GateFacts
          declaration={view.facts?.declaration ?? null}
          riskDerived={view.recorded}
          derivedNow={view.ship?.derived ?? null}
          reviewProviders={providersOf(view)}
          head={view.facts?.head ?? null}
        />
      </div>
      <div class="min-w-0 flex-1">
        <ShipInput view={view} />
      </div>
    </div>
  );
}

function Findings(props: { readonly view: GateView }) {
  const { reviews } = props.view;
  return (
    <div class="flex flex-col gap-2">
      <h3 class="m-0 text-base font-bold text-ink">Reviewer findings</h3>
      {reviews.length === 0 ? (
        <p class="m-0 text-sm text-muted">No Reviewer has reviewed this head yet</p>
      ) : (
        <ul class="m-0 flex list-none flex-col gap-2 p-0 text-sm">
          {reviews.map((review) => (
            <li class="flex flex-col gap-1">
              <p class="m-0 font-bold">
                {`${review.reviewer} (${review.provider ?? 'unknown provider'}): ${reasonText(review.state)}`}
              </p>
              {review.findings.length === 0 ? (
                <p class="m-0 text-muted">No findings</p>
              ) : (
                <ul class="m-0 pl-5">
                  {review.findings.map((finding) => (
                    <li class="break-words">{finding}</li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const decisions = [
  ['approve', 'Approve'],
  ['reject', 'Reject'],
  ['take_over', 'Take over'],
  ['override', 'Override'],
] as const;

function DecisionForm(props: { readonly gate: PanelGate }) {
  const { view, ability } = props.gate;
  const { itemId, harnessId } = view;
  const refusals = new Map(Object.entries(refusalsOf(view, ability)));
  return (
    <CommandForm harnessId={harnessId} command="decide" itemId={itemId}>
      <div class="flex w-full min-w-0 flex-col gap-4">
        <input type="hidden" name="itemId" value={itemId} />
        <Facts view={view} />
        <Findings view={view} />
        <TextAreaField
          name="findings"
          label="Findings, one per line"
          scope={itemId}
          maxLength={25_000}
        />
        <TextField name="reason" label="Reason for an override" scope={itemId} maxLength={2_000} />
        <div class="flex flex-wrap items-center gap-3">
          {decisions.map(([value, label]) => (
            <HumanActionButton
              itemId={itemId}
              label={label}
              name="decision"
              value={value}
              disabledReason={refusals.get(value) ?? null}
            />
          ))}
        </div>
      </div>
    </CommandForm>
  );
}

export function GatePanel(props: { readonly gate: PanelGate }) {
  const { gate } = props;
  const { view } = gate;
  return (
    <GateCallout itemId={view.itemId} title={gate.title} reason={null} actions={null}>
      {gate.decides ? (
        <DecisionForm gate={gate} />
      ) : (
        <div class="flex flex-col gap-4">
          <Facts view={view} />
          <Findings view={view} />
        </div>
      )}
    </GateCallout>
  );
}
