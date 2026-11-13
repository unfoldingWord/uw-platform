import type { Context } from 'hono';
import type { HealthIndicator, HealthReport } from '@uw/contracts';
import { formatCount, formatMoney } from '@uw/core/money';
import type { DailyPoint, PlaneTotals } from '@uw/harness';
import { Badge } from '@uw/ui/components/badge.tsx';
import { DailyChart } from '@uw/ui/components/chart.tsx';
import { Card } from '@uw/ui/components/card.tsx';
import { Kpi, KpiRow } from '@uw/ui/components/kpi.tsx';
import { PageHead } from '@uw/ui/components/page-head.tsx';
import type { AppEnv } from '../../deps.ts';
import { AGENT_PLANE_INDICATORS } from '../../health/agent-plane.ts';
import { spendCapOf } from '../../health/spend-cap.ts';
import { renderScreen, screenKernel } from '../parts/frame.tsx';
import { indicatorText, statusOf } from '../parts/health-words.ts';
import { pageNames } from '../parts/names.ts';
import { healthPath } from '../parts/paths.ts';
import { moduleCodes } from '../parts/platform-nav.ts';

const focus = 'outline-offset-2 outline-accent-text focus-visible:outline-2';
const drilled: ReadonlySet<string> = new Set(AGENT_PLANE_INDICATORS);
const off: ReadonlySet<string> = new Set(['not_configured', 'not_wired']);

function watching(report: HealthReport): readonly HealthIndicator[] {
  return report.indicators.filter((indicator) => indicator.status === 'amber');
}

function sentenceOf(report: HealthReport): string {
  if (report.indicators.some((indicator) => indicator.status === 'red'))
    return 'Something needs attention';
  const watch = watching(report).length;
  if (watch === 0) return 'Running, nothing to watch';
  return `Running, with ${watch} ${watch === 1 ? 'thing' : 'things'} to watch`;
}

function ledeOf(report: HealthReport): string {
  const failing = report.indicators.some((indicator) => indicator.status === 'red');
  const notOn = report.indicators
    .filter((indicator) => off.has(indicator.status))
    .map((indicator) => indicatorText(indicator.name));
  const first = failing ? 'Something is failing.' : 'Nothing is failing.';
  if (notOn.length === 0) return `${first} Everything is switched on.`;
  return `${first} Not switched on yet: ${notOn.join(', ')}.`;
}

function StatusMark(props: { readonly indicator: HealthIndicator }) {
  const status = statusOf(props.indicator.status);
  if (props.indicator.status === 'ok')
    return <span class="text-xs text-text-3">{status.words}</span>;
  return (
    <Badge tone={props.indicator.status === 'amber' ? 'info' : status.tone}>{status.words}</Badge>
  );
}

function IndicatorRow(props: { readonly indicator: HealthIndicator }) {
  const { indicator } = props;
  const quiet = indicator.status === 'ok' || off.has(indicator.status);
  const row = (
    <KpiRow
      label={indicatorText(indicator.name)}
      status={<StatusMark indicator={indicator} />}
      detail={indicator.detail}
      quiet={quiet}
    />
  );
  if (!drilled.has(indicator.name)) return <li>{row}</li>;
  return (
    <li>
      <a href={healthPath(indicator.name)} class={`block hover:bg-raised ${focus}`}>
        {row}
      </a>
    </li>
  );
}

function money(minor: number): string {
  return formatMoney({ amountMinor: minor, currency: 'USD' });
}

function Figures(props: { readonly totals: PlaneTotals; readonly capMinor: number }) {
  const { totals } = props;
  const spent = totals.spend.meteredMinor + totals.spend.computeMinor;
  const shapes = totals.runsToday.byShape;
  const runs = Object.values(shapes).reduce((sum, count) => sum + count, 0);
  const refusals = Object.values(totals.gateRefusals.byReason).reduce((a, b) => a + b, 0);
  return (
    <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Kpi
        label="Spend this month"
        value={money(spent)}
        detail={`of the ${money(props.capMinor)} cap`}
      />
      <Kpi
        label="Runs today"
        value={formatCount(runs)}
        detail={`${formatCount(shapes['workflow-run'])} platform · ${formatCount(shapes['external-run'])} own machine`}
      />
      <Kpi
        label="Live delegations"
        value={formatCount(totals.liveDelegations.count)}
        detail={`${formatCount(totals.liveDelegations.merge)} to merge`}
      />
      <Kpi label="Gate refusals" value={formatCount(refusals)} detail="in the last 7 days" />
    </div>
  );
}

function RunsChart(props: { readonly days: readonly DailyPoint[] }) {
  const total = props.days.reduce((sum, day) => sum + day.runs, 0);
  const waits = props.days.reduce((sum, day) => sum + day.gateWaits, 0);
  return (
    <section aria-label="Agent runs" class="flex flex-col rounded-md border border-line bg-surface">
      <div class="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-4 py-3">
        <h2 class="m-0 text-md font-heavy text-text">Agent runs</h2>
        <p class="m-0 text-xs font-semibold text-text-3">{props.days.length} days</p>
        <p
          data-total
          class="m-0 rounded-sm bg-accent-soft px-1 text-xs leading-normal font-heavy text-accent-text"
        >
          {`${formatCount(total)} runs`}
        </p>
        <p class="m-0 ml-auto flex items-center gap-4 text-xs text-text-3">
          <span class="flex items-center gap-1">
            <span aria-hidden="true" class="size-size-1 rounded-full bg-accent"></span>runs per day
          </span>
          <span class="flex items-center gap-1">
            <span aria-hidden="true" class="h-px w-size-2 bg-text-2"></span>
            {`gate waits · ${formatCount(waits)}`}
          </span>
        </p>
      </div>
      <div class="px-4 py-3">
        <DailyChart
          id="runs-30"
          label={`Agent runs per day and gate waits, the last ${props.days.length} days`}
          days={props.days.map((day) => day.day.slice(5))}
          bars={props.days.map((day) => day.runs)}
          line={props.days.map((day) => day.gateWaits)}
        />
      </div>
    </section>
  );
}

export async function healthScreen(c: Context<AppEnv>, report: HealthReport): Promise<Response> {
  const screen = screenKernel(c);
  const read = screen === null ? null : { at: screen.at };
  const totals =
    screen === null || read === null ? null : await screen.kernel.views.planeTotals(read);
  const days =
    screen === null || read === null
      ? []
      : await screen.kernel.views.daily(screen.caller, { harnessId: null }, read);
  const spec = {
    title: pageNames.health,
    current: healthPath(),
    code: moduleCodes.health,
    crumbs: [{ label: pageNames.infrastructure }, { label: pageNames.health }],
  };
  return renderScreen(
    c,
    spec,
    <div class="flex flex-col gap-4">
      <PageHead
        eyebrow="Agent plane · one trace id end to end"
        title={sentenceOf(report)}
        lede={ledeOf(report)}
        flush
      />
      {totals === null ? null : <Figures totals={totals} capMinor={spendCapOf(c.env).capMinor} />}
      {days.length === 0 ? null : <RunsChart days={days} />}
      <Card title="Indicators" sub="each one with a detail page opens it" flush>
        <ul aria-label="Indicators" class="m-0 list-none p-0">
          {report.indicators.map((indicator) => (
            <IndicatorRow indicator={indicator} />
          ))}
        </ul>
      </Card>
    </div>,
  );
}
