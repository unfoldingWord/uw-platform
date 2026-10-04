import type { HealthIndicator, HealthReport } from '@uw/contracts';
import type { Accepted, Kernel, KernelHealth } from '@uw/harness';
import { agentPlaneIndicators } from '../../health/agent-plane.ts';
import { overallStatus } from '../../health/indicators.ts';
import type { VerbContext } from '../context.ts';
import { gatedHandler, refusal } from '../handler.ts';

type HarnessScene = Extract<
  Awaited<ReturnType<Kernel['reads']['harness']>>,
  Accepted<unknown>
>['value'];

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

async function reportOf(
  context: VerbContext,
  scene: HarnessScene,
  health: KernelHealth,
): Promise<HealthReport> {
  const plane = await agentPlaneIndicators({
    kernel: context.kernel,
    db: context.db,
    at: context.at,
    cap: context.cap,
  });
  const indicators = [harnessIndicator(scene), databaseIndicator(health), ...plane];
  return { status: overallStatus(indicators), commit: context.commit, indicators };
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
    return { status: 'accepted', output: await reportOf(context, scene, health) };
  },
});
