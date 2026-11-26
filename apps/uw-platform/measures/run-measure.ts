import type { MeasureRunState } from '@uw/contracts';
import {
  failedStep,
  finishMeasureRun,
  installRun,
  observeResource,
  prepareRun,
  releaseRun,
  type Observed,
  type Prepared,
  type RunDeps,
  type RunInstall,
} from './run-steps.ts';
import type { StepKind } from './step-budgets.ts';

export type MeasureStep = <T>(name: string, work: () => Promise<T>, kind: StepKind) => Promise<T>;

async function observedOne(
  deps: RunDeps,
  runId: string,
  resourceId: string,
  install: RunInstall,
  step: MeasureStep,
): Promise<Observed> {
  const name = `resource ${resourceId}`;
  try {
    return await step(name, () => observeResource(deps, runId, resourceId, install), 'sandbox');
  } catch {
    return step(`failed ${name}`, () => failedStep(deps, runId, resourceId), 'record');
  }
}

async function measureEach(
  deps: RunDeps,
  runId: string,
  prepared: Prepared,
  step: MeasureStep,
): Promise<void> {
  try {
    const install = await step('install', () => installRun(deps, runId), 'sandbox');
    for (const resourceId of prepared.resourceIds) {
      if ((await observedOne(deps, runId, resourceId, install, step)) === 'stopped') break;
    }
  } finally {
    await step('release', () => releaseRun(deps, runId), 'record');
  }
}

async function measuredAll(
  deps: RunDeps,
  runId: string,
  prepared: Prepared,
  step: MeasureStep,
): Promise<void> {
  if (prepared.resourceIds.length === 0) return;
  try {
    await measureEach(deps, runId, prepared, step);
  } catch {
    return;
  }
}

export async function runMeasure(
  deps: RunDeps,
  runId: string,
  step: MeasureStep,
): Promise<MeasureRunState> {
  const prepared = await step('prepare', () => prepareRun(deps, runId), 'record');
  await measuredAll(deps, runId, prepared, step);
  const planned = prepared.resourceIds.length;
  return step('finish', () => finishMeasureRun(deps.db, runId, planned, deps.now()), 'record');
}
