import type { Principal } from '@uw/contracts';
import { errorFields, type Logger } from '@uw/core/log';
import {
  assistantRole,
  runToolLoop,
  type AssistantLoop,
  type Caller,
  type Kernel,
  type ModelEngine,
  type SettledLoop,
} from '@uw/harness';
import type { AssistantTurnStart } from '../../env.ts';
import type { AssistantSteps, TurnStepConfig } from './steps.ts';
import type { AssistantHost } from '../../mcp/assistant-host.ts';

type BegunTurn = {
  readonly turnId: string;
  readonly principal: Principal;
  readonly loop: AssistantLoop;
};

export type HostOpener = (
  begun: BegunTurn,
  start: AssistantTurnStart,
  at: Date,
) => Promise<AssistantHost>;

export type AssistantTurnDeps = {
  readonly kernel: Kernel;
  readonly system: Caller;
  readonly turn: ModelEngine['turn'];
  readonly openHost: HostOpener;
  readonly newId: () => string;
  readonly now: () => Date;
  readonly logger: Logger;
};

type RefusedStep = { readonly status: 'refused'; readonly reason: string; readonly why: string };
type Begun = { readonly status: 'begun'; readonly turnId: string } | RefusedStep;
type Looped = { readonly status: 'looped'; readonly result: SettledLoop } | RefusedStep;

const ATTEMPT_STEP: TurnStepConfig = { retries: 3, timeout: '15 minutes' };
const BEGIN_STEP: TurnStepConfig = { retries: 3, timeout: '15 minutes' };
const LOOP_STEP: TurnStepConfig = { retries: 0, timeout: '15 minutes' };
const FINISH_STEP: TurnStepConfig = { retries: 6, timeout: '15 minutes' };

class FinishHeld extends Error {
  constructor(reason: string) {
    super(`the reply of this turn is not settled yet: ${reason}`);
    this.name = 'FinishHeld';
  }
}

async function begun(
  deps: AssistantTurnDeps,
  start: AssistantTurnStart,
  attemptId: string,
): Promise<BegunTurn | RefusedStep> {
  const outcome = await deps.kernel.assistants.beginTurn(deps.system, {
    requestId: start.requestId,
    attemptId,
  });
  if (outcome.status === 'accepted') return outcome.value;
  const why = outcome.detail['why'];
  return { status: 'refused', reason: outcome.reason, why: typeof why === 'string' ? why : '' };
}

async function begin(
  deps: AssistantTurnDeps,
  start: AssistantTurnStart,
  attemptId: string,
): Promise<Begun> {
  const turn = await begun(deps, start, attemptId);
  return 'status' in turn ? turn : { status: 'begun', turnId: turn.turnId };
}

async function loopOf(
  deps: AssistantTurnDeps,
  start: AssistantTurnStart,
  attemptId: string,
): Promise<Looped> {
  const turn = await begun(deps, start, attemptId);
  if ('status' in turn) return turn;
  const host = await deps.openHost(turn, start, deps.now());
  try {
    const result = await runToolLoop(deps.turn, host.tools, turn.loop, () => Promise.resolve());
    return { status: 'looped', result };
  } finally {
    await host.close();
  }
}

function failed(model: string): SettledLoop {
  return {
    outcome: 'failed',
    text: null,
    usage: { inputTokens: 0, outputTokens: 0, costMicros: null },
    resolvedProvider: null,
    resolvedModel: model,
    toolsCalled: [],
    turns: 0,
  };
}

async function looped(
  steps: AssistantSteps,
  deps: AssistantTurnDeps,
  start: AssistantTurnStart,
  attemptId: string,
): Promise<Looped> {
  try {
    return await steps.do('loop', LOOP_STEP, () => loopOf(deps, start, attemptId));
  } catch (error) {
    deps.logger.warn('assistant turn loop failed', {
      outcome: 'assistant_loop_failed',
      request_id: start.requestId,
      ...errorFields(error),
    });
    return { status: 'looped', result: failed(assistantRole.model) };
  }
}

async function finish(
  deps: AssistantTurnDeps,
  start: AssistantTurnStart,
  turnId: string,
  result: SettledLoop,
): Promise<string> {
  const outcome = await deps.kernel.assistants.finishTurn(deps.system, {
    requestId: start.requestId,
    turnId,
    result,
  });
  if (outcome.status === 'accepted') return outcome.value.delivery;
  if (outcome.reason === 'request_in_flight') throw new FinishHeld(outcome.reason);
  return outcome.reason;
}

function refusedAs(step: RefusedStep): string {
  return step.why === '' ? step.reason : step.why;
}

export async function runAssistantTurn(
  start: AssistantTurnStart,
  steps: AssistantSteps,
  deps: AssistantTurnDeps,
): Promise<string> {
  const attemptId = await steps.do('attempt', ATTEMPT_STEP, () => Promise.resolve(deps.newId()));
  const opened = await steps.do('begin', BEGIN_STEP, () => begin(deps, start, attemptId));
  if (opened.status === 'refused') return refusedAs(opened);
  const done = await looped(steps, deps, start, attemptId);
  if (done.status === 'refused') return refusedAs(done);
  const { turnId } = opened;
  return steps.do('finish', FINISH_STEP, () => finish(deps, start, turnId, done.result));
}
