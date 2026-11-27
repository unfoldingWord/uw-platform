import type { AssistantProvisioningStep } from '@uw/contracts';
import { assist, persona } from './persona-steps.ts';
import {
  accountWork,
  dueWork,
  progressOf,
  putProgress,
  type AccountWork,
  type Progress,
} from './rows.ts';
import type { ProvisionerDeps, StepOutcome } from './types.ts';
import { suspendUser, workspaceUser } from './workspace-steps.ts';
import { deactivateBot, zulipBot } from './zulip-steps.ts';

type Step = {
  readonly name: AssistantProvisioningStep;
  readonly run: (deps: ProvisionerDeps, work: AccountWork) => Promise<StepOutcome>;
};

export type Driven = {
  readonly harnessId: string;
  readonly step: AssistantProvisioningStep;
  readonly outcome: StepOutcome['kind'];
};

const enableSteps: readonly Step[] = [
  { name: 'workspace_user', run: workspaceUser },
  { name: 'zulip_bot', run: zulipBot },
  { name: 'persona', run: persona },
  { name: 'assist', run: assist },
];

const disableSteps: readonly Step[] = [
  { name: 'suspend_user', run: suspendUser },
  { name: 'deactivate_bot', run: deactivateBot },
];

const MINUTE_MS = 60_000;
const WAIT_MINUTES = 5;
const BACKOFF_MOST_MINUTES = 60;

function nextAt(now: Date, outcome: StepOutcome, attempts: number): Date {
  if (outcome.kind === 'done') return now;
  const minutes =
    outcome.kind === 'waiting' ? WAIT_MINUTES : Math.min(2 ** attempts, BACKOFF_MOST_MINUTES);
  return new Date(now.getTime() + minutes * MINUTE_MS);
}

function sameFailure(before: Progress | null, after: Progress): boolean {
  return (
    before !== null &&
    before.accountVersion === after.accountVersion &&
    before.step === after.step &&
    before.failure === after.failure
  );
}

async function recorded(deps: ProvisionerDeps, before: Progress | null, after: Progress) {
  const { harnessId } = after;
  if (after.status === 'failed' && after.failure !== null && !sameFailure(before, after)) {
    const record = { harnessId, step: after.step, why: after.failure };
    await deps.kernel.assistants.recordProvisioning(deps.caller, record);
  }
  const fresh = before?.status !== 'done' || before.accountVersion !== after.accountVersion;
  if (after.status === 'done' && fresh) {
    const goal = disableSteps.some((step) => step.name === after.step) ? 'disabled' : 'enabled';
    await deps.kernel.assistants.recordProvisioning(deps.caller, { harnessId, done: goal });
  }
}

async function settled(
  deps: ProvisionerDeps,
  work: AccountWork,
  step: AssistantProvisioningStep,
  outcome: StepOutcome,
): Promise<Driven> {
  const before = await progressOf(deps.db, work.harnessId);
  const now = deps.clock.now();
  const again = before?.accountVersion === work.version && before.step === step;
  const attempts = outcome.kind === 'failed' ? (again ? before.attempts : 0) + 1 : 0;
  const after: Progress = {
    harnessId: work.harnessId,
    personId: work.personId,
    accountVersion: work.version,
    step,
    status: outcome.kind === 'failed' ? 'failed' : outcome.kind === 'waiting' ? 'waiting' : 'done',
    failure: outcome.kind === 'failed' ? outcome.why : null,
    attempts,
    nextAt: nextAt(now, outcome, attempts),
    updatedAt: now,
  };
  await putProgress(deps.db, after);
  await recorded(deps, before, after);
  return { harnessId: work.harnessId, step, outcome: outcome.kind };
}

async function driveAssistant(deps: ProvisionerDeps, work: AccountWork): Promise<Driven> {
  const steps = work.status === 'enabled' ? enableSteps : disableSteps;
  let last: Step | undefined;
  for (const step of steps) {
    last = step;
    const outcome = await step.run(deps, work);
    if (outcome.kind !== 'done') return settled(deps, work, step.name, outcome);
  }
  const final = last?.name ?? 'assist';
  return settled(deps, work, final, { kind: 'done' });
}

export async function driveHarness(
  deps: ProvisionerDeps,
  harnessId: string,
): Promise<Driven | null> {
  const work = await accountWork(deps.db, harnessId);
  return work === null ? null : driveAssistant(deps, work);
}

export async function provisionDue(
  deps: ProvisionerDeps,
  limit: number,
): Promise<readonly Driven[]> {
  const driven: Driven[] = [];
  for (const work of await dueWork(deps.db, deps.clock.now(), limit)) {
    driven.push(await driveAssistant(deps, work));
  }
  return driven;
}
