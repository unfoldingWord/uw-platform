import type { Harness } from '@uw/contracts';
import type { Caller } from '../caller.ts';
import { draft, recordContext, recordHarnessEvents } from '../items/record.ts';
import { lockKeys } from '../lock-keys.ts';
import { accepted, refused, type KernelOutcome, type Refused } from '../outcome.ts';
import type { Ports, RunRow, StoreTransaction } from '../ports.ts';
import type { HarnessScene } from '../reads/scene.ts';
import { resumeRunsWhere } from '../runs/resume.ts';
import { hibernateRunsWhere } from '../runs/suspend.ts';
import { adminRefusal, agentRefusal } from './rules.ts';

type PausePorts = Pick<Ports, 'clock' | 'grants' | 'ids' | 'store' | 'runs'>;

export type PauseInput = { readonly harnessId: string; readonly stageKey: string | null };

type Flip = {
  readonly harness: Harness;
  readonly stageKey: string | null;
  readonly paused: boolean;
};

async function flipHarness(tx: StoreTransaction, flip: Flip): Promise<boolean | Refused> {
  const { harness, paused } = flip;
  if (harness.paused === paused) return false;
  const changed = await tx.harnesses.write.setPaused(harness.id, paused);
  return changed || refused('harness_not_found', { harnessId: harness.id });
}

async function flipLane(tx: StoreTransaction, flip: Flip, stageKey: string) {
  const stages = await tx.harnessStages.read.forHarness(flip.harness.id);
  const stage = stages.find((entry) => entry.key === stageKey);
  if (stage === undefined) return refused('stage_not_found', { stage: stageKey });
  if (stage.paused === flip.paused) return false;
  const changed = await tx.harnessStages.write.update({ ...stage, paused: flip.paused });
  return changed || refused('stage_not_found', { stage: stageKey });
}

function flipIn(tx: StoreTransaction, flip: Flip): Promise<boolean | Refused> {
  return flip.stageKey === null ? flipHarness(tx, flip) : flipLane(tx, flip, flip.stageKey);
}

async function sceneOf(
  tx: StoreTransaction,
  harnessId: string,
): Promise<KernelOutcome<HarnessScene>> {
  const harness = await tx.harnesses.read.byId(harnessId);
  if (harness === null) return refused('harness_not_found', { harnessId });
  return accepted({ harness, stages: await tx.harnessStages.read.forHarness(harnessId) });
}

async function stageOfRun(tx: StoreTransaction, run: RunRow): Promise<string | null> {
  const item = await tx.harnessItems.read.byId(run.itemId);
  return item?.stageKey ?? null;
}

async function runsToHibernate(tx: StoreTransaction, input: PauseInput): Promise<RunRow[]> {
  const live = await tx.harnessRuns.read.live(input.harnessId);
  const chosen: RunRow[] = [];
  for (const run of live) {
    if (run.outcome !== 'running' || run.runShape !== 'workflow-run') continue;
    if (input.stageKey === null || (await stageOfRun(tx, run)) === input.stageKey) {
      chosen.push(run);
    }
  }
  return chosen;
}

async function runsToResume(tx: StoreTransaction, harnessId: string): Promise<RunRow[]> {
  const harness = await tx.harnesses.read.byId(harnessId);
  if (harness === null || harness.paused) return [];
  const stages = await tx.harnessStages.read.forHarness(harnessId);
  const paused = new Set(stages.filter((stage) => stage.paused).map((stage) => stage.key));
  const live = await tx.harnessRuns.read.live(harnessId);
  const chosen: RunRow[] = [];
  for (const run of live) {
    if (run.outcome !== 'hibernated' || run.hibernatedFor !== 'paused') continue;
    const stageKey = await stageOfRun(tx, run);
    if (stageKey !== null && !paused.has(stageKey)) chosen.push(run);
  }
  return chosen;
}

async function settleRuns(ports: PausePorts, input: PauseInput, paused: boolean): Promise<void> {
  if (paused) {
    await hibernateRunsWhere(ports, (tx) => runsToHibernate(tx, input), 'paused');
    return;
  }
  await resumeRunsWhere(ports, (tx) => runsToResume(tx, input.harnessId), 'paused');
}

export async function setPause(
  ports: PausePorts,
  caller: Caller,
  input: PauseInput,
  paused: boolean,
): Promise<KernelOutcome<HarnessScene>> {
  const agent = agentRefusal(caller);
  if (agent !== null) return agent;
  const at = ports.clock.now();
  const outcome = await ports.store.transaction(async (tx) => {
    await tx.lock(lockKeys.harnessStages(input.harnessId));
    const harness = await tx.harnesses.read.byId(input.harnessId);
    if (harness === null) return refused('harness_not_found', { harnessId: input.harnessId });
    const denied = await adminRefusal(ports, tx, caller, harness, at);
    if (denied !== null) return denied;
    const changed = await flipIn(tx, { harness, stageKey: input.stageKey, paused });
    if (changed !== true && changed !== false) return changed;
    if (changed) {
      const name = paused ? 'harness_paused' : 'harness_resumed';
      await recordHarnessEvents(tx, recordContext(ports, caller, at), harness.id, [
        draft(name, { stage: input.stageKey }),
      ]);
    }
    return sceneOf(tx, harness.id);
  });
  if (outcome.status === 'accepted') await settleRuns(ports, input, paused);
  return outcome;
}
