import type { HealthIndicator, IndicatorStatus } from '@uw/contracts';
import { formatInstant } from '@uw/core/dates';
import { formatCount, formatMoney } from '@uw/core/money';
import type { Executor } from '@uw/db/client';
import type { BreakerState, Kernel, PlaneTotals } from '@uw/harness';
import { sweepHealth, type SweepHealth } from '../github/facts/queries.ts';
import type { SpendCap } from './spend-cap.ts';

export const AGENT_PLANE_INDICATORS = [
  'spend',
  'breaker',
  'runs_today',
  'live_delegations',
  'gate_refusals_week',
  'agent_writes',
  'stale_learnings',
  'github_sweep',
] as const;

export type AgentPlaneSource = {
  readonly kernel: Kernel;
  readonly db: Executor;
  readonly at: Date;
  readonly cap: SpendCap;
};

const DETAIL_LIMIT = 200;
const SPEND_AMBER_PERCENT = 75;
const SPEND_RED_PERCENT = 90;
const HOUR_MS = 3_600_000;
const DELEGATION_SOON_MS = 24 * HOUR_MS;
const SWEEP_STALE_MS = 48 * HOUR_MS;
const SWEEP_BEHIND_MS = 72 * HOUR_MS;

function usd(amountMinor: number): string {
  return formatMoney({ amountMinor, currency: 'USD' });
}

function fitted(head: string, list: readonly string[]): string {
  let detail = head;
  for (const [index, entry] of list.entries()) {
    const next = `${detail}${index === 0 ? '; ' : ', '}${entry}`;
    if (next.length > DETAIL_LIMIT) break;
    detail = next;
  }
  return detail.slice(0, DETAIL_LIMIT);
}

function counted(count: number, capped: boolean): string {
  return capped ? `at least ${formatCount(count)}` : formatCount(count);
}

function byCountThenName(counts: Readonly<Record<string, number>>): readonly string[] {
  return Object.entries(counts)
    .filter(([, count]) => count > 0)
    .sort(([left, a], [right, b]) => b - a || left.localeCompare(right, 'en'))
    .map(([name, count]) => `${name} ${formatCount(count)}`);
}

function spendStatus(percent: number): IndicatorStatus {
  if (percent >= SPEND_RED_PERCENT) return 'red';
  return percent >= SPEND_AMBER_PERCENT ? 'amber' : 'ok';
}

function spendIndicator(
  totals: PlaneTotals,
  cap: SpendCap,
  breaker: BreakerState,
): HealthIndicator {
  const { meteredMinor, computeMinor, subscriptionTokens } = totals.spend;
  const spentMinor = meteredMinor + computeMinor;
  const percent = Math.floor((spentMinor * 100) / cap.capMinor);
  const status = spendStatus(percent);
  const parts = [
    `${usd(spentMinor)} metered of ${usd(cap.capMinor)} this month`,
    `${formatCount(subscriptionTokens)} subscription tokens reported`,
    ...(breaker.reading === null ? [] : [`the breaker reads ${breaker.reading.percent} percent`]),
  ];
  return { name: 'spend', status, detail: parts.join('; ') };
}

const breakerStatus = {
  open: 'ok',
  holding: 'amber',
  pausing: 'red',
} as const satisfies Record<BreakerState['level'], IndicatorStatus>;

function breakerIndicator(breaker: BreakerState): HealthIndicator {
  const { reading } = breaker;
  if (reading === null || (!breaker.fresh && breaker.level !== 'pausing')) {
    return { name: 'breaker', status: 'amber', detail: 'no fresh reading' };
  }
  const cap = formatMoney({ amountMinor: reading.capMinor, currency: reading.currency });
  const detail = `${reading.percent.toString()} percent of ${cap} spent`;
  return { name: 'breaker', status: breakerStatus[breaker.level], detail };
}

function runsTodayIndicator({ runsToday }: PlaneTotals): HealthIndicator {
  const platform = formatCount(runsToday.byShape['workflow-run']);
  const own = formatCount(runsToday.byShape['external-run']);
  const head = `${platform} on the platform, ${own} on own machines`;
  return {
    name: 'runs_today',
    status: 'ok',
    detail: fitted(head, byCountThenName(runsToday.byEngine)),
  };
}

function delegationsIndicator({ at, liveDelegations }: PlaneTotals): HealthIndicator {
  const { count, soonestExpiry } = liveDelegations;
  if (count === 0 || soonestExpiry === null) {
    return { name: 'live_delegations', status: 'ok', detail: 'None live' };
  }
  const soon = soonestExpiry.getTime() - at.getTime() < DELEGATION_SOON_MS;
  const detail = `${formatCount(count)} live; next expiry ${formatInstant(soonestExpiry)}`;
  return { name: 'live_delegations', status: soon ? 'amber' : 'ok', detail };
}

function refusalsIndicator({ gateRefusals }: PlaneTotals): HealthIndicator {
  const { byReason, capped } = gateRefusals;
  const total = Object.values(byReason).reduce((sum, count) => sum + count, 0);
  const head = `${counted(total, capped)} in 7 days`;
  const status = capped ? 'amber' : 'ok';
  return { name: 'gate_refusals_week', status, detail: fitted(head, byCountThenName(byReason)) };
}

function writesIndicator({ agentWrites }: PlaneTotals): HealthIndicator {
  const detail = `${counted(agentWrites.count, agentWrites.capped)} events by agents in 24 hours`;
  return { name: 'agent_writes', status: agentWrites.capped ? 'amber' : 'ok', detail };
}

function staleIndicator({ staleLearnings }: PlaneTotals): HealthIndicator {
  const { count, capped } = staleLearnings;
  const status = count > 0 || capped ? 'amber' : 'ok';
  return {
    name: 'stale_learnings',
    status,
    detail: `${counted(count, capped)} past their review date`,
  };
}

type SweepBucket =
  'ok' | 'never' | 'failed' | 'stale' | 'capped' | 'deferred' | 'stalled' | 'behind';

const bucketWords: ReadonlyMap<SweepBucket, string> = new Map<SweepBucket, string>([
  ['ok', 'ok'],
  ['never', 'never swept'],
  ['failed', 'failed'],
  ['stale', 'older than 48 hours'],
  ['capped', 'capped'],
  ['deferred', 'deferred'],
  ['stalled', 'stalled'],
  ['behind', 'more than 72 hours behind'],
]);
const redBuckets: ReadonlySet<SweepBucket> = new Set(['never', 'failed', 'stale']);
const amberOutcomes: ReadonlyMap<string, SweepBucket> = new Map([
  ['capped', 'capped'],
  ['deferred', 'deferred'],
  ['stalled', 'stalled'],
]);

function bucketOf(repo: SweepHealth, at: Date): SweepBucket {
  const last = repo.lastSweep;
  if (last === null) return 'never';
  if (last.outcome === 'failed') return 'failed';
  const lastAt = Date.parse(last.at);
  if (at.getTime() - lastAt > SWEEP_STALE_MS) return 'stale';
  const amber = amberOutcomes.get(last.outcome);
  if (amber !== undefined) return amber;
  const through = repo.sweptThrough?.getTime() ?? lastAt;
  return lastAt - through > SWEEP_BEHIND_MS ? 'behind' : 'ok';
}

function sweepStatus(buckets: readonly SweepBucket[]): IndicatorStatus {
  if (buckets.some((bucket) => redBuckets.has(bucket))) return 'red';
  return buckets.some((bucket) => bucket !== 'ok') ? 'amber' : 'ok';
}

function sweepIndicator(repos: readonly SweepHealth[], at: Date): HealthIndicator {
  if (repos.length === 0) {
    return { name: 'github_sweep', status: 'not_configured', detail: 'No repositories installed' };
  }
  const buckets = repos.map((repo) => bucketOf(repo, at));
  const counts = new Map<SweepBucket, number>();
  for (const bucket of buckets) counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
  const status = sweepStatus(buckets);
  const parts = [...bucketWords].flatMap(([bucket, words]) => {
    const count = counts.get(bucket);
    return count === undefined ? [] : [`${formatCount(count)} ${words}`];
  });
  const noun = repos.length === 1 ? 'repository' : 'repositories';
  const detail = fitted(`${formatCount(repos.length)} ${noun}`, parts);
  return { name: 'github_sweep', status, detail };
}

export async function agentPlaneIndicators(
  source: AgentPlaneSource,
): Promise<readonly HealthIndicator[]> {
  const { kernel, at } = source;
  const totals = await kernel.views.planeTotals({ at });
  const breaker = await kernel.breaker.state(at);
  const repos = await sweepHealth(source.db);
  return [
    spendIndicator(totals, source.cap, breaker),
    breakerIndicator(breaker),
    runsTodayIndicator(totals),
    delegationsIndicator(totals),
    refusalsIndicator(totals),
    writesIndicator(totals),
    staleIndicator(totals),
    sweepIndicator(repos, at),
  ];
}
