import { formatCount, formatMoney } from '@uw/core/money';
import { formatInstant } from '@uw/core/dates';
import type { ApproveAt } from '@uw/contracts';
import type { PersonaDashboard, PersonaRunSummary } from '@uw/harness';
import { Kpi } from '@uw/ui/components/kpi.tsx';
import { Table } from '@uw/ui/components/table.tsx';
import { reasonText } from '@uw/ui/components/text.ts';
import { itemPath } from './paths.ts';

const focus = 'outline-offset-2 outline-focus focus-visible:outline-2';
const link = `text-link underline ${focus}`;

function money(amountMinor: number): string {
  return formatMoney({ amountMinor, currency: 'USD' });
}

function escalationText(dashboard: PersonaDashboard): { value: string; detail: string } {
  const { ended, escalated } = dashboard.escalation;
  if (ended === 0) return { value: '0%', detail: 'No runs ended today' };
  const rate = Math.round((escalated / ended) * 100);
  return { value: `${rate}%`, detail: `${escalated} of ${ended} runs ended today` };
}

const approveAtText: Readonly<Record<ApproveAt, string>> = {
  zero_findings: 'Zero findings',
  no_real_or_plausible: 'No real or plausible finding',
};

function refuteDetail(refutes: NonNullable<PersonaDashboard['refutes']>): string {
  if (refutes.findings === 0) return 'No findings in 30 days';
  const rate = `${Math.round((refutes.refuted / refutes.findings) * 100)}% refuted`;
  return refutes.capped ? `${rate}, at least` : rate;
}

export function PersonaKpis(props: { readonly dashboard: PersonaDashboard }) {
  const { runsToday, spend } = props.dashboard;
  const escalation = escalationText(props.dashboard);
  const spent = `${money(spend.costMinor)} metered, ${money(spend.computeMinor)} compute; ${formatCount(spend.subscriptionTokens)} subscription tokens`;
  return (
    <div class="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <Kpi
        label="Runs today"
        value={formatCount(runsToday.total)}
        detail={`${runsToday.byHost.platform} on the platform, ${runsToday.byHost.external} external`}
      />
      <Kpi
        label="Spend today"
        value={money(spend.costMinor + spend.computeMinor)}
        detail={`${spent}. Budget ${money(spend.budgetMinor)} a month`}
      />
      <Kpi label="Escalation rate" value={escalation.value} detail={escalation.detail} />
      <Kpi label="Gate refusals today" value={formatCount(props.dashboard.gateRefusals)} />
      <Kpi label="Premises held today" value={formatCount(props.dashboard.premisesHeld)} />
      <Kpi label="Writes today" value={formatCount(props.dashboard.writes)} />
      {props.dashboard.approveAt === null ? null : (
        <Kpi
          label="Approves at"
          value={approveAtText[props.dashboard.approveAt]}
          detail="The strictness preset on this persona page"
        />
      )}
      {props.dashboard.refutes === null ? null : (
        <Kpi
          label="Refuted findings, 30 days"
          value={`${formatCount(props.dashboard.refutes.refuted)} of ${formatCount(props.dashboard.refutes.findings)}`}
          detail={refuteDetail(props.dashboard.refutes)}
        />
      )}
    </div>
  );
}

const runColumns = [
  { key: 'started', label: 'Started' },
  { key: 'item', label: 'Item' },
  { key: 'host', label: 'Host' },
  { key: 'engine', label: 'Engine' },
  { key: 'outcome', label: 'Outcome' },
  { key: 'steps', label: 'Steps' },
] as const;

function stepsText(run: PersonaRunSummary): string {
  if (run.steps.length === 0) return 'No steps yet';
  return run.steps
    .map((step) => `${step.step}: ${formatCount(step.tokensIn + step.tokensOut)} tokens`)
    .join(', ');
}

export function LastRuns(props: { readonly dashboard: PersonaDashboard }) {
  const { lastRuns, harness } = props.dashboard;
  if (lastRuns.length === 0) return <p class="mb-6 text-sm text-muted">No runs yet</p>;
  const rows = lastRuns.map((run) => ({
    started: formatInstant(new Date(run.startedAt)),
    item: (
      <a href={itemPath(harness.id, run.itemId)} class={link}>
        Play-by-play
      </a>
    ),
    host: run.runShape === 'external-run' ? 'External' : 'Platform',
    engine: run.engine,
    outcome: reasonText(run.outcome),
    steps: stepsText(run),
  }));
  return (
    <div class="mb-6">
      <Table caption="The last runs of this persona" columns={runColumns} rows={rows} />
    </div>
  );
}

const delegationColumns = [
  { key: 'person', label: 'Delegated by' },
  { key: 'capability', label: 'Capability' },
  { key: 'expires', label: 'Expires' },
] as const;

export function Delegations(props: { readonly dashboard: PersonaDashboard }) {
  const { count, live } = props.dashboard.delegations;
  if (live === null) {
    return <p class="mb-6 text-sm text-muted">{`${formatCount(count)} live delegations`}</p>;
  }
  if (live.length === 0) return <p class="mb-6 text-sm text-muted">No live delegations</p>;
  const rows = live.map((delegation) => ({
    person: delegation.personId,
    capability: delegation.capability,
    expires: formatInstant(new Date(delegation.expiresAt)),
  }));
  const more = count - live.length;
  return (
    <div class="mb-6">
      <Table
        caption="The live delegations of this persona"
        columns={delegationColumns}
        rows={rows}
      />
      {more > 0 ? (
        <p class="mt-2 text-sm text-muted">{`and ${formatCount(more)} more live delegations`}</p>
      ) : null}
    </div>
  );
}
