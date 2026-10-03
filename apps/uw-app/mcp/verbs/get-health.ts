import type { HealthIndicator, HealthReport } from '@uw/contracts';
import type { Accepted, BreakerState, Kernel, KernelHealth } from '@uw/harness';
import { overallStatus } from '../../health/indicators.ts';
import type { VerbContext } from '../context.ts';
import { gatedHandler, refusal } from '../handler.ts';

type HarnessScene = Extract<
  Awaited<ReturnType<Kernel['reads']['harness']>>,
  Accepted<unknown>
>['value'];

const WB10_INDICATORS = [
  'spend',
  'breaker',
  'runs_today',
  'live_delegations',
  'gate_refusals_week',
  'agent_writes',
  'stale_learnings',
] as const;
const WB10_DETAIL = 'built with WB-10, step 8';

function harnessIndicator(scene: HarnessScene): HealthIndicator {
  const { harness } = scene;
  return harness.paused
    ? { name: 'harness', status: 'amber', detail: `${harness.key} is paused` }
    : { name: 'harness', status: 'ok', detail: `${harness.key} is running` };
}

function databaseIndicator(health: KernelHealth): HealthIndicator {
  const count = health.appliedMigrations.length;
  return { name: 'database', status: 'ok', detail: `${count} migrations applied` };
}

const breakerStatus = {
  open: 'ok',
  holding: 'amber',
  pausing: 'red',
} as const satisfies Record<BreakerState['level'], HealthIndicator['status']>;

function breakerIndicator(breaker: BreakerState): HealthIndicator {
  if (breaker.reading === null) {
    return { name: 'breaker', status: 'amber', detail: 'no reading yet, hosted runs are held' };
  }
  const status = breakerStatus[breaker.level];
  const detail = `${breaker.reading.percent.toString()} percent of the cap spent`;
  return { name: 'breaker', status, detail };
}

type Readings = {
  readonly health: KernelHealth;
  readonly breaker: BreakerState;
  readonly commit: string;
};

function reportOf(scene: HarnessScene, { health, breaker, commit }: Readings): HealthReport {
  const indicators: HealthIndicator[] = [
    harnessIndicator(scene),
    databaseIndicator(health),
    ...WB10_INDICATORS.map((name): HealthIndicator => {
      if (name === 'breaker') return breakerIndicator(breaker);
      return { name, status: 'not_wired', detail: WB10_DETAIL };
    }),
  ];
  return { status: overallStatus(indicators), commit, indicators };
}

function readScene(context: VerbContext, harnessId: string) {
  return context.kernel.reads.harness(
    { actor: context.principal, traceId: context.traceId },
    { harnessId },
    { at: context.at },
  );
}

export const getHealth = gatedHandler({
  name: 'get_health',
  hidden: (input) => refusal('harness_not_found', { harnessId: input.harnessId }),
  resource: async (context, input) => {
    const scene = await readScene(context, input.harnessId);
    if (scene.status === 'error') return refusal(scene.reason, scene.detail);
    const found: HarnessScene = scene.value;
    return { resource: { kind: 'area', area: found.harness.jdArea }, found };
  },
  run: async (context, _input, scene: HarnessScene) => {
    const health = await context.kernel.health();
    const breaker = await context.kernel.breaker.state();
    const readings = { health, breaker, commit: context.commit };
    return { status: 'accepted', output: reportOf(scene, readings) };
  },
});
