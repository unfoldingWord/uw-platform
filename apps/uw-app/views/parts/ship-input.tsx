import { shipRefusalSchema, type GateView, type ShipRefusal } from '@uw/contracts';
import { formatInstant } from '@uw/core/dates';
import { Note } from '@uw/ui/components/note.tsx';
import { Table } from '@uw/ui/components/table.tsx';
import { reasonText } from '@uw/ui/components/text.ts';

type Ship = NonNullable<GateView['ship']>;

const columns = [
  { key: 'input', label: 'Input' },
  { key: 'value', label: 'Current value' },
];

export function failingReasons(view: GateView): readonly ShipRefusal[] {
  const outcome = view.ship?.outcome;
  if (outcome === undefined || outcome.verdict === 'advance') return [];
  const failing = new Set(outcome.reasons);
  return shipRefusalSchema.options.filter((reason) => failing.has(reason));
}

export function reasonsText(reasons: readonly string[]): string {
  return reasons.map(reasonText).join(', ');
}

function pullRequestText(pull: Ship['input']['pullRequest']): string {
  if (pull === null) return 'None';
  const state = pull.open ? 'Open' : 'Closed';
  return `${state}${pull.draft ? ', draft' : ''}, head ${pull.head}`;
}

function listed(values: readonly string[]): string {
  return values.length === 0 ? 'None' : values.join(', ');
}

function rowsOf(view: GateView, ship: Ship) {
  const { input } = ship;
  const failing = failingReasons(view);
  return [
    { input: 'Pull request', value: pullRequestText(input.pullRequest) },
    { input: 'Expected head', value: input.expectedHead ?? 'None' },
    ...input.checks.map((check) => ({
      input: check.name,
      value: check.conclusion === null ? 'Pending' : reasonText(check.conclusion),
    })),
    ...input.approvals.map((approval) => ({
      input: approval.reviewer,
      value: `Approved by provider ${approval.provider ?? 'unknown'}`,
    })),
    { input: 'Risk tier', value: input.riskTier ?? 'Not derived' },
    { input: 'Risk domains', value: listed(input.riskDomains) },
    { input: 'Area', value: input.area },
    { input: 'Evaluated at', value: formatInstant(new Date(input.at)) },
    { input: 'Ship rule', value: failing.length === 0 ? 'Advance' : reasonsText(failing) },
  ];
}

export function ShipInput(props: { readonly view: GateView }) {
  const { ship } = props.view;
  if (ship === null) {
    return (
      <Note>This gate is not at a merge or publish stage, so the ship rule does not apply.</Note>
    );
  }
  const behind = failingReasons(props.view).includes('base_behind');
  return (
    <>
      <Table caption="Ship rule inputs" columns={columns} rows={rowsOf(props.view, ship)} />
      {behind ? (
        <Note>
          Waiting for a base update. Update this pull request from its base: an approval carries
          across a merge from base, so you do not need to approve it again.
        </Note>
      ) : null}
    </>
  );
}
