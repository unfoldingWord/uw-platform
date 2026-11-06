import type { GateView } from '@uw/contracts';
import type { DecideAbility } from '@uw/harness';
import { CommandForm } from '@uw/ui/components/command-form.tsx';
import { TextAreaField, TextField } from '@uw/ui/components/field.tsx';
import { GateCallout, GateFacts } from '@uw/ui/components/gate-callout.tsx';
import { HumanActionButton, HumanCallout } from '@uw/ui/components/human-action.tsx';
import { Icon } from '@uw/ui/components/icon.tsx';
import { reasonText } from '@uw/ui/components/text.ts';
import { failingReasons, reasonsText, ShipInput } from './ship-input.tsx';
import { RULE_COUNT, RulesRing, rulesMet, ShipRules } from './ship-rules.tsx';

export type GatePlace = {
  readonly harness: string;
  readonly stage: string;
  readonly number: string | null;
  readonly waited: string | null;
};

export type PanelGate = {
  readonly view: GateView;
  readonly title: string;
  readonly ability: DecideAbility;
  readonly decides: boolean;
  readonly place?: GatePlace | undefined;
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

function Risk(props: { readonly view: GateView }) {
  const { view } = props;
  return (
    <aside aria-label="Risk" class="min-w-0 lg:w-aside lg:shrink-0">
      <h3 class="m-0 mb-2 text-sm font-heavy text-text">Risk</h3>
      <GateFacts
        declaration={view.facts?.declaration ?? null}
        riskDerived={view.recorded}
        derivedNow={view.ship?.derived ?? null}
        reviewProviders={providersOf(view)}
        head={view.facts?.head ?? null}
      />
    </aside>
  );
}

function Inputs(props: { readonly view: GateView }) {
  return (
    <details>
      <summary class="cursor-pointer text-xs text-text-3 outline-offset-2 outline-accent-text focus-visible:outline-2">
        Ship rule inputs
      </summary>
      <div class="mt-2">
        <ShipInput view={props.view} />
      </div>
    </details>
  );
}

function Facts(props: { readonly view: GateView }) {
  const { view } = props;
  return (
    <div class="flex flex-col gap-5 lg:flex-row">
      <div class="flex min-w-0 flex-1 flex-col gap-4">
        <ShipRules view={view} />
        <Inputs view={view} />
        <Findings view={view} />
      </div>
      <Risk view={view} />
    </div>
  );
}

function Findings(props: { readonly view: GateView }) {
  const { reviews } = props.view;
  return (
    <div class="flex flex-col gap-2">
      <h3 class="m-0 text-base font-heavy text-text">Reviewer findings</h3>
      {reviews.length === 0 ? (
        <p class="m-0 text-sm text-text-3">No Reviewer has reviewed this head yet</p>
      ) : (
        <ul class="m-0 flex list-none flex-col gap-2 p-0 text-sm">
          {reviews.map((review) => (
            <li class="flex flex-col gap-1">
              <p class="m-0 font-heavy">
                {`${review.reviewer} (${review.provider ?? 'unknown provider'}): ${reasonText(review.state)}`}
              </p>
              {review.findings.length === 0 ? (
                <p class="m-0 text-text-3">No findings</p>
              ) : (
                <ul class="m-0 pl-5">
                  {review.findings.map((finding) => (
                    <li class="break-words">
                      {finding.weight === null
                        ? finding.text
                        : `${reasonText(finding.weight)}: ${finding.text}`}
                    </li>
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
      <div class="flex w-full min-w-0 flex-col gap-3 border-t border-line pt-4">
        <input type="hidden" name="itemId" value={itemId} />
        {view.facts?.head === undefined || view.facts.head === null ? null : (
          <input type="hidden" name="head" value={view.facts.head} />
        )}
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

type Verdict = GateView['verdicts'][number];

type Refuting = {
  readonly view: GateView;
  readonly verdict: Verdict;
  readonly place: number;
  readonly index: number;
};

function RefuteForm(props: Refuting) {
  const { view, verdict, place, index } = props;
  const scope = `${verdict.runId}-${String(index)}`;
  const label = `Mark finding ${String(index + 1)} of verdict ${String(place + 1)} (${verdict.reviewer}) refuted`;
  return (
    <CommandForm harnessId={view.harnessId} command="refute_finding" itemId={scope}>
      <input type="hidden" name="itemId" value={view.itemId} />
      <input type="hidden" name="runId" value={verdict.runId} />
      <input type="hidden" name="finding" value={String(index)} />
      <HumanActionButton itemId={scope} label={label} name="refute" value="refute" />
    </CommandForm>
  );
}

function VerdictFindings(props: {
  readonly view: GateView;
  readonly verdict: Verdict;
  readonly place: number;
  readonly refutes: boolean;
}) {
  const { view, verdict, place, refutes } = props;
  return (
    <ul class="m-0 flex flex-col gap-2 pl-5">
      {verdict.findings.map((finding, index) => (
        <li class="flex flex-wrap items-center gap-2 break-words">
          <span>{`${reasonText(finding.weight)}: ${finding.text}`}</span>
          {finding.refuted ? <span class="text-text-3">Refuted</span> : null}
          {refutes && !finding.refuted ? (
            <RefuteForm view={view} verdict={verdict} place={place} index={index} />
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function Verdicts(props: { readonly view: GateView; readonly refutes: boolean }) {
  const { view, refutes } = props;
  if (view.verdicts.length === 0) return null;
  return (
    <div class="flex flex-col gap-2">
      <h3 class="m-0 text-base font-heavy text-text">Reviewer verdicts on this item</h3>
      <ul class="m-0 flex list-none flex-col gap-3 p-0 text-sm">
        {view.verdicts.map((verdict, place) => (
          <li class="flex flex-col gap-1">
            <p class="m-0 font-heavy">{`${verdict.reviewer}: ${reasonText(verdict.verdict)}`}</p>
            <VerdictFindings view={view} verdict={verdict} place={place} refutes={refutes} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function placeText(place: GatePlace | undefined): string | undefined {
  if (place === undefined) return undefined;
  return [place.harness, place.number, place.stage].filter((part) => part !== null).join(' / ');
}

function PullLine(props: { readonly view: GateView }) {
  const { view } = props;
  const pull = view.ship?.input.pullRequest ?? null;
  if (pull === null) return null;
  const head = view.facts?.head ?? view.expectedHead;
  return (
    <span class="flex items-center gap-1">
      <Icon name="code-pull-request" size={1} />
      {`PR ${pull.open ? 'open' : 'closed'}${head === null ? '' : ' at '}`}
      {head === null ? null : <span class="font-mono">{head.slice(0, 7)}</span>}
    </span>
  );
}

function Waited(props: { readonly waited: string | null }) {
  if (props.waited === null) return null;
  return (
    <span class="flex items-center gap-1">
      <Icon name="clock" size={1} />
      {`waiting ${props.waited}`}
    </span>
  );
}

function Meta(props: { readonly gate: PanelGate }) {
  const { view, place } = props.gate;
  const tier = view.recorded?.riskTier ?? null;
  return (
    <>
      <PullLine view={view} />
      {tier === null ? null : <span>{tier}</span>}
      <Waited waited={place?.waited ?? null} />
    </>
  );
}

function Refused(props: { readonly gate: PanelGate }) {
  const { view } = props.gate;
  if (!props.gate.decides || view.ship === null) return null;
  const failing = failingReasons(view);
  if (failing.length === 0) return null;
  return (
    <HumanCallout
      lead="You can't approve this head yet."
      text={`${failing.length} of the ${RULE_COUNT} ship rules ${failing.length === 1 ? "isn't" : "aren't"} met. You can still reject it, take it over, or override with a reason.`}
    />
  );
}

export function GatePanel(props: { readonly gate: PanelGate }) {
  const { gate } = props;
  const { view } = gate;
  return (
    <GateCallout
      itemId={view.itemId}
      title={gate.title}
      reason={null}
      actions={null}
      eyebrow={placeText(gate.place)}
      meta={<Meta gate={gate} />}
      aside={view.ship === null ? undefined : <RulesRing met={rulesMet(view)} />}
    >
      <Refused gate={gate} />
      <Facts view={view} />
      <Verdicts view={view} refutes={gate.decides} />
      {gate.decides ? <DecisionForm gate={gate} /> : null}
    </GateCallout>
  );
}
