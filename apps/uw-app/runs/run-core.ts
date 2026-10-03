import type { RunFailure } from '@uw/contracts';
import { parseReviewVerdict, type RunStart } from '@uw/harness';
import {
  readBody,
  scoutBody,
  submitBody,
  workBody,
  type Mismatch,
  type ModelDone,
  type ReadDone,
} from './bodies.ts';
import type { RunDeps } from './deps.ts';
import { haltedBy, type Halted } from './steps.ts';
import {
  STEP,
  WAIT_SLICE,
  WAIT_SLICES,
  WORK_STEP,
  type Json,
  type StepConfig,
  type StepRunner,
} from './step-runner.ts';

type Flow = {
  readonly runId: string;
  readonly steps: StepRunner;
  readonly deps: RunDeps;
  waits: number;
};

type FailStep = 'read' | 'scout' | 'work' | 'submit';
type Hibernated = Extract<Halted, { readonly kind: 'hibernated' }>;
type Awake = Exclude<Halted, Hibernated>;
type Ended = Extract<Halted, { readonly kind: 'ended' }>;
type Kinded = { readonly kind: string } & { readonly [key: string]: Json };
type Wake = 'resumed' | 'ended' | 'timed_out';

const ended: Ended = { kind: 'ended' };
const PRINTABLE = /^[ -~]{1,200}$/;

function errorName(error: unknown): string {
  const name = error instanceof Error ? error.name : 'Error';
  return PRINTABLE.test(name) ? name : 'Error';
}

function outcomeOf(settled: { readonly status: string }): Json {
  return { kind: settled.status === 'accepted' ? 'done' : 'refused' };
}

function awake<T extends Kinded>(result: T | Halted): result is Exclude<T | Halted, Hibernated> {
  return result.kind !== 'hibernated';
}

async function runState(flow: Flow): Promise<string> {
  const progress = await flow.deps.runKernel.runs.progress(flow.deps.host, flow.runId);
  return progress.status === 'accepted' ? progress.value.run.outcome : 'missing';
}

async function awaitWake(flow: Flow): Promise<Wake> {
  flow.waits += 1;
  const label = `wake ${flow.waits.toString()}`;
  for (let slice = 0; slice < WAIT_SLICES; slice += 1) {
    await flow.steps.waitForResume(`${label} wait ${slice.toString()}`, WAIT_SLICE);
    const state = await flow.steps.do(`${label} check ${slice.toString()}`, STEP, () =>
      runState(flow),
    );
    if (state === 'running') return 'resumed';
    if (state !== 'hibernated') return 'ended';
  }
  return 'timed_out';
}

async function halt(flow: Flow, name: string): Promise<Ended> {
  const { deps, runId } = flow;
  await flow.steps.do(name, STEP, async () =>
    outcomeOf(await deps.runKernel.runs.halt(deps.host, runId, 'gate_wait_expired')),
  );
  return ended;
}

async function attempt<T extends Kinded>(
  flow: Flow,
  name: string,
  config: StepConfig,
  body: () => Promise<T | Halted>,
): Promise<T | Halted> {
  try {
    return await flow.steps.do<T | Halted>(name, config, body);
  } catch (error) {
    return { kind: 'failed', detail: errorName(error) };
  }
}

async function stepped<T extends Kinded>(
  flow: Flow,
  name: string,
  config: StepConfig,
  body: () => Promise<T | Halted>,
): Promise<Exclude<T | Halted, Hibernated>> {
  for (let round = 0; ; round += 1) {
    const label = round === 0 ? name : `${name} again ${round.toString()}`;
    const result = await attempt(flow, label, config, body);
    if (awake(result)) return result;
    const woke = await awaitWake(flow);
    if (woke === 'ended') return ended;
    if (woke === 'timed_out') return halt(flow, `${label} wait expired`);
  }
}

async function failRun(flow: Flow, step: FailStep, why: RunFailure, detail: string | null) {
  const { deps, runId } = flow;
  await flow.steps.do(`record failure ${step}`, STEP, async () =>
    outcomeOf(await deps.runKernel.runs.fail(deps.host, runId, { step, why, detail })),
  );
  return 'failed';
}

function settled(flow: Flow, step: FailStep, result: Awake | Mismatch): Promise<string> {
  if (result.kind === 'ended') return Promise.resolve('ended');
  if (result.kind === 'mismatch') return failRun(flow, step, 'provider_mismatch', result.detail);
  return failRun(flow, step, 'retries_exhausted', result.detail);
}

async function hostStep(
  flow: Flow,
  name: string,
  call: (deps: RunDeps) => Promise<{ readonly status: string }>,
) {
  await flow.steps.do(name, STEP, async () => outcomeOf(await call(flow.deps)));
}

type DiffRead = { readonly kind: 'diff'; readonly diff: string };

function reviewDiff(flow: Flow): Promise<DiffRead | Awake> {
  const { deps, runId } = flow;
  return stepped<DiffRead>(flow, 'review diff', STEP, async () => {
    const read = await deps.runKernel.runs.reviewDiff(deps.host, runId);
    if (read.status !== 'accepted') return haltedBy(read.reason, read.detail);
    return 'diff' in read.value ? { kind: 'diff', diff: read.value.diff } : ended;
  });
}

async function postReview(flow: Flow, work: ModelDone): Promise<string> {
  const { deps, runId } = flow;
  const verdict = parseReviewVerdict(work.text);
  await hostStep(flow, 'post review', (d) =>
    verdict.ok
      ? d.runKernel.runs.postReview(deps.host, runId, {
          ...verdict.verdict,
          resolvedProvider: work.resolvedProvider,
          resolvedModel: work.resolvedModel,
        })
      : d.runKernel.runs.complete(deps.host, runId, { result: 'review_withheld', review: null }),
  );
  return 'reviewed';
}

async function closeAfterSubmit(flow: Flow): Promise<string> {
  const { deps, runId } = flow;
  const submitted = await stepped(flow, 'submit', STEP, () => submitBody(deps, runId));
  if (submitted.kind !== 'submitted') return settled(flow, 'submit', submitted);
  if (submitted.result !== 'parked') {
    await hostStep(flow, 'close', (d) =>
      d.runKernel.runs.complete(deps.host, runId, { result: 'submitted', review: null }),
    );
    return 'submitted';
  }
  const woke = await awaitWake(flow);
  if (woke === 'ended') return 'ended';
  if (woke === 'timed_out') {
    await halt(flow, 'gate wait expired');
    return 'gate_wait_expired';
  }
  await hostStep(flow, 'close', (d) =>
    d.runKernel.runs.complete(deps.host, runId, { result: 'decided', review: null }),
  );
  return 'decided';
}

async function afterWork(flow: Flow, read: ReadDone, diff: string | null): Promise<string> {
  const { deps, runId } = flow;
  const work = await stepped(flow, 'work', WORK_STEP, () =>
    workBody(deps, runId, { ...read, diff }),
  );
  if (work.kind !== 'model') return settled(flow, 'work', work);
  if (work.outcome === 'turn_limit') return failRun(flow, 'work', 'turn_limit', null);
  if (read.review) return postReview(flow, work);
  return closeAfterSubmit(flow);
}

async function afterRead(flow: Flow, read: ReadDone): Promise<string> {
  const { deps, runId } = flow;
  const diff = read.review ? await reviewDiff(flow) : null;
  if (diff !== null && diff.kind !== 'diff') return settled(flow, 'work', diff);
  const scout = await stepped(flow, 'scout', STEP, () => scoutBody(deps, runId, read));
  if (scout.kind !== 'scout') return settled(flow, 'scout', scout);
  if (!scout.holds) {
    await hostStep(flow, 'hold premise', (d) =>
      d.runKernel.runs.holdPremise(deps.host, runId, { reason: scout.reason }),
    );
    return 'premise_held';
  }
  return afterWork(flow, read, diff?.diff ?? null);
}

export async function runWorkflow(
  start: RunStart,
  steps: StepRunner,
  deps: RunDeps,
): Promise<string> {
  const flow: Flow = { runId: start.runId, steps, deps, waits: 0 };
  const read = await stepped(flow, 'read', STEP, () => readBody(deps, start.runId));
  if (read.kind !== 'read') return settled(flow, 'read', read);
  return afterRead(flow, read);
}
