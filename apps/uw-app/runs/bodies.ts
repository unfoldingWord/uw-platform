import { verbIo, type Engine, type submitToGateResultSchema, type VerbName } from '@uw/contracts';
import { errorFields } from '@uw/core/log';
import {
  parseScoutVerdict,
  PortNotWiredError,
  ProviderMismatchError,
  SCOUT_ENGINE,
} from '@uw/harness';
import { engineAdapter } from '../engines/registry.ts';
import type { EngineWork, EngineWorkResult } from '../engines/seam.ts';
import { builderAccess, pulledChange } from './builder-github.ts';
import type { RunDeps } from './deps.ts';
import { contextText, fixPrompt, reviewPrompt, scoutPrompt, workPrompt } from './prompts.ts';
import { promptSourceOf, reviewSourceOf, titleSourceOf, type ReadText } from './prompt-source.ts';
import {
  callCore,
  countedHttp,
  countedTools,
  haltedBy,
  isOpen,
  minorOf,
  openStep,
  recordStep,
  sceneCaller,
  StepHalted,
  type Halted,
  type OpenStep,
} from './steps.ts';

export type ReadDone = ReadText & {
  readonly kind: 'read';
  readonly review: boolean;
  readonly fix: boolean;
};

export type ModelDone = {
  readonly kind: 'model';
  readonly text: string | null;
  readonly outcome: EngineWorkResult['outcome'];
  readonly resolvedProvider: string | null;
  readonly resolvedModel: string;
};

export type Mismatch = { readonly kind: 'mismatch'; readonly detail: string };

export type ScoutDone = {
  readonly kind: 'scout';
  readonly holds: boolean;
  readonly reason: string;
};

export type Submitted = {
  readonly kind: 'submitted';
  readonly result: (typeof submitToGateResultSchema.options)[number];
};

type ModelPlan = {
  readonly step: 'scout' | 'work';
  readonly engine: Engine;
  readonly model: string;
  readonly provider: string;
  readonly prompt: string;
};

const readOnly: ReadonlySet<VerbName> = new Set<VerbName>([
  'search_pages',
  'read_page',
  'resolve_context',
  'query_entities',
  'get_health',
]);
const RENEW_MS = 5 * 60 * 1000;
const NO_VERDICT = 'no scout verdict';

async function within<T>(
  deps: RunDeps,
  runId: string,
  only: ReadonlySet<VerbName> | null,
  work: (open: OpenStep) => Promise<T | Halted>,
): Promise<T | Halted> {
  const opened = await openStep(deps, runId, only);
  if (!isOpen(opened)) return opened;
  try {
    return await work(opened);
  } catch (error) {
    if (error instanceof StepHalted) return haltedBy(error.reason, error.detail);
    throw error;
  } finally {
    await opened.close();
  }
}

export async function readContext(open: OpenStep): Promise<string> {
  const reply = await callCore(open.core, 'resolve_context', { itemId: open.scene.item.itemId });
  return contextText(JSON.stringify(reply));
}

export function readBody(deps: RunDeps, runId: string): Promise<ReadDone | Halted> {
  return within(deps, runId, null, async (open) => {
    const { item, capability } = open.scene;
    const context = await readContext(open);
    const prompts = await recordStep(open, { step: 'read', tokensIn: 0, tokensOut: 0 });
    return {
      kind: 'read',
      title: item.title,
      titleSource: titleSourceOf(item),
      context,
      prompts: [...prompts],
      comments: [],
      review: capability === 'review',
      fix: capability === 'fix',
    };
  });
}

function onTurnOf(deps: RunDeps, open: OpenStep): () => Promise<void> {
  let renewed = deps.clock.now().getTime();
  const { run, item } = open.scene;
  return async () => {
    const found = await deps.runKernel.runs.scene(deps.host, run.id);
    if (found.status !== 'accepted') throw new StepHalted(found.reason, found.detail);
    const now = deps.clock.now().getTime();
    if (now - renewed < RENEW_MS) return;
    const lease = await deps.verbKernel.items.renewLease(sceneCaller(open.scene), {
      itemId: item.itemId,
    });
    if (lease.status !== 'accepted') throw new StepHalted(lease.reason, lease.detail);
    renewed = now;
  };
}

async function engineWork(
  deps: RunDeps,
  engine: Engine,
  work: EngineWork,
): Promise<EngineWorkResult> {
  try {
    return await engineAdapter(deps.engines, engine).work(work);
  } catch (error) {
    if (error instanceof PortNotWiredError) {
      deps.logger.warn('engine not wired', { outcome: 'not_wired', engine, ...errorFields(error) });
    }
    throw error;
  }
}

function merged(first: readonly VerbName[], second: readonly VerbName[]): VerbName[] {
  return [...new Set([...first, ...second])];
}

function unrunFix(plan: ModelPlan): ModelDone {
  return {
    kind: 'model',
    text: null,
    outcome: 'checks_not_run_locally',
    resolvedProvider: null,
    resolvedModel: plan.model,
  };
}

async function modelRun(deps: RunDeps, open: OpenStep, plan: ModelPlan): Promise<ModelDone> {
  const { run, item, persona } = open.scene;
  const tools = countedTools(open.client);
  const toolset = persona.toolset.filter(
    (verb) => verb !== 'record_run_step' && (plan.step === 'work' || readOnly.has(verb)),
  );
  const http = countedHttp(open.http, new Set(toolset));
  const refused = (host: string, path: string) =>
    deps.logger.warn('sandbox egress refused', { outcome: 'egress_refused', host, path });
  const access = await builderAccess(deps, open.scene, plan.step);
  if (plan.step === 'work' && open.scene.capability === 'fix' && access.checkout === null) {
    return unrunFix(plan);
  }
  const result = await engineWork(deps, plan.engine, {
    runId: run.id,
    itemId: item.itemId,
    traceId: run.traceId,
    persona: persona.identity,
    model: plan.model,
    pinnedProvider: plan.provider,
    instructions: persona.instructions,
    prompt: plan.prompt,
    toolset,
    checkout: access.checkout,
    tools,
    onTurn: onTurnOf(deps, open),
    egress: { mcp: http.handle, github: access.github, refused },
  });
  await recordStep(open, {
    step: plan.step,
    tokensIn: result.inputTokens,
    tokensOut: result.outputTokens,
    costMinor: minorOf(result.costMicros),
    computeMinor: result.computeMinor,
    model: result.resolvedModel,
    resolvedProvider: plan.step === 'work' ? result.resolvedProvider : null,
    toolsCalled: merged(result.toolsCalled, http.called()),
    writes: tools.writes() + http.writes(),
  });
  const { text, outcome, resolvedProvider, resolvedModel } = result;
  return { kind: 'model', text, outcome, resolvedProvider, resolvedModel };
}

async function guardedModelRun(
  deps: RunDeps,
  open: OpenStep,
  plan: ModelPlan,
): Promise<ModelDone | Mismatch> {
  try {
    return await modelRun(deps, open, plan);
  } catch (error) {
    if (!(error instanceof ProviderMismatchError)) throw error;
    return { kind: 'mismatch', detail: `${plan.provider}/${error.resolved ?? 'none'}` };
  }
}

function scoutPlan(deps: RunDeps, open: OpenStep, prompt: string): ModelPlan {
  const { persona } = open.scene;
  const own = persona.engine === SCOUT_ENGINE;
  return {
    step: 'scout',
    engine: SCOUT_ENGINE,
    model: own ? persona.model : deps.scout.model,
    provider: own ? persona.provider : deps.scout.provider,
    prompt,
  };
}

export function scoutBody(
  deps: RunDeps,
  runId: string,
  read: ReadText,
): Promise<ScoutDone | Mismatch | Halted> {
  return within(deps, runId, readOnly, async (open) => {
    const done = await guardedModelRun(
      deps,
      open,
      scoutPlan(deps, open, scoutPrompt(promptSourceOf(read, open.scene.item.itemId))),
    );
    if (done.kind === 'mismatch') return done;
    const verdict = parseScoutVerdict(done.text);
    if (!verdict.ok) return { kind: 'scout', holds: false, reason: NO_VERDICT };
    const { premise, reason } = verdict.verdict;
    return { kind: 'scout', holds: premise === 'holds', reason };
  });
}

function promptOf(read: ReadDone & { readonly diff: string | null }, itemId: string): string {
  if (read.diff !== null) return reviewPrompt(reviewSourceOf(read, itemId, read.diff));
  const source = promptSourceOf(read, itemId);
  return read.fix ? fixPrompt(source) : workPrompt(source);
}

export function workBody(
  deps: RunDeps,
  runId: string,
  read: ReadDone & { readonly diff: string | null },
): Promise<ModelDone | Mismatch | Halted> {
  return within(deps, runId, null, (open) => {
    const { persona, item } = open.scene;
    const prompt = promptOf(read, item.itemId);
    return guardedModelRun(deps, open, {
      step: 'work',
      engine: persona.engine,
      model: persona.model,
      provider: persona.provider,
      prompt,
    });
  });
}

async function parkAtGate(deps: RunDeps, runId: string): Promise<Submitted | Halted> {
  const parked = await deps.runKernel.runs.hibernateAtGate(deps.host, runId);
  if (parked.status === 'accepted') return { kind: 'submitted', result: 'parked' };
  const halted = haltedBy(parked.reason, parked.detail);
  return halted.kind === 'hibernated' ? { kind: 'submitted', result: 'parked' } : halted;
}

async function submitHeld(deps: RunDeps, runId: string): Promise<Submitted | Halted> {
  const sent = await within(deps, runId, null, async (open) => {
    const recorded = open.scene.run.steps.some((step) => step.step === 'submit');
    if (!recorded) await recordStep(open, { step: 'submit', tokensIn: 0, tokensOut: 0 });
    const change = await pulledChange(deps, open.scene);
    const reply = await callCore(open.core, 'submit_to_gate', {
      itemId: open.scene.item.itemId,
      evidence: {},
      to: null,
      pullRequest: change?.pullRequest ?? null,
      head: change?.head ?? null,
    });
    const { result } = verbIo.submit_to_gate.output.parse(reply);
    return { kind: 'submitted' as const, result };
  });
  if (sent.kind !== 'submitted' || sent.result !== 'parked') return sent;
  return parkAtGate(deps, runId);
}

export async function submitBody(deps: RunDeps, runId: string): Promise<Submitted | Halted> {
  const progress = await deps.runKernel.runs.progress(deps.host, runId);
  if (progress.status !== 'accepted') return haltedBy(progress.reason, progress.detail);
  const { run, item } = progress.value;
  if (item.holder === run.persona) return submitHeld(deps, runId);
  if (item.gateStatus === 'parked') return parkAtGate(deps, runId);
  return { kind: 'submitted', result: 'advanced' };
}
