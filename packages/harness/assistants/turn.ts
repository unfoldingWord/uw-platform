import {
  assistantIdentityOf,
  harnessSchema,
  identitySchema,
  type AssistantTurnRefusal,
  type ErrorReason,
  type Harness,
  type Identity,
  type Principal,
} from '@uw/contracts';
import { isSystemPrincipal } from '../access.ts';
import type { Caller } from '../caller.ts';
import type { KernelSettings } from '../kernel-settings.ts';
import { draft, recordContext, recordHarnessEvents, type RecordContext } from '../items/record.ts';
import { lockKeys } from '../lock-keys.ts';
import { accepted, refused, type KernelOutcome, type Refused } from '../outcome.ts';
import { activePersonaOn } from '../personas/projection.ts';
import type { AssistantRequestRow, Ports, StoreTransaction } from '../ports.ts';
import { spendRefusal } from '../runs/breaker-level.ts';
import { personaOfPage, personaPageOf } from '../runs/persona.ts';
import type { LoopResult } from '../runs/tool-loop.ts';
import type { RunPersona } from '../runs/types.ts';
import { boundAssist, liveAssist, type LiveAssist } from './delegation.ts';
import { anyNamed, requestEvents, startedTurn, type StartedTurn } from './ledger.ts';
import { assistantPrincipal } from './principal.ts';
import { finishedDraft } from './reply.ts';
import { assistantRole } from './role.ts';
import { monthlyMinorOf, poolSpent } from './pool.ts';
import { budgetSpent, spendThisMonth } from './spend.ts';
import { loopOf, type AssistantLoop } from './loop.ts';

export type Turn = {
  readonly turnId: string;
  readonly principal: Principal;
  readonly loop: AssistantLoop;
};
export type BeginInput = { readonly requestId: string; readonly attemptId: string };

type TurnPorts = Pick<Ports, 'clock' | 'grants' | 'ids' | 'store'>;
type Persona = {
  readonly run: RunPersona;
  readonly version: number;
  readonly monthlyMinor: number;
};
type Admitted = { readonly persona: Persona; readonly assist: LiveAssist };
type Scene = {
  readonly tx: StoreTransaction;
  readonly ports: TurnPorts;
  readonly settings: KernelSettings;
  readonly context: RecordContext;
  readonly request: AssistantRequestRow;
  readonly harness: Harness;
};

const uuid = harnessSchema.shape.id;
const reasons: ReadonlyMap<AssistantTurnRefusal, ErrorReason> = new Map<
  AssistantTurnRefusal,
  ErrorReason
>([
  ['delegation_required', 'delegation_required'],
  ['persona_inactive', 'not_permitted'],
  ['spend_held', 'spend_held'],
  ['assistant_budget_spent', 'spend_held'],
  ['turn_taken', 'stale_version'],
  ['harness_paused', 'not_permitted'],
  ['assistants_capped', 'spend_held'],
]);

const unspent: LoopResult = {
  outcome: 'refused',
  text: null,
  usage: { inputTokens: 0, outputTokens: 0, costMicros: 0 },
  resolvedProvider: null,
  resolvedModel: assistantRole.model,
  toolsCalled: [],
  turns: 0,
};

async function closeTurn(
  scene: Scene,
  open: StartedTurn,
  why: AssistantTurnRefusal,
): Promise<Refused> {
  const { tx, context, request } = scene;
  await recordHarnessEvents(tx, context, request.harnessId, [
    draft('assistant_turn_refused', { requestId: request.id, why }),
    finishedDraft({ requestId: request.id, turnId: open.turnId, result: unspent }),
  ]);
  const detail = { why, requestId: request.id, turnId: open.turnId };
  return refused(reasons.get(why) ?? 'not_permitted', detail);
}

async function refuseTurn(scene: Scene, why: AssistantTurnRefusal): Promise<Refused> {
  const { tx, context, request } = scene;
  await recordHarnessEvents(tx, context, request.harnessId, [
    draft('assistant_turn_refused', { requestId: request.id, why }),
  ]);
  return refused(reasons.get(why) ?? 'not_permitted', { why, requestId: request.id });
}

async function activePersona(scene: Scene, identity: Identity): Promise<Persona | null> {
  const facts = await activePersonaOn(scene.tx, identity, scene.harness.id);
  const page = personaPageOf(facts ?? undefined);
  const run = personaOfPage(facts ?? undefined);
  if (page === null || 'status' in run || page.frontmatter.identity !== identity) return null;
  return { run, version: page.facts.version, monthlyMinor: page.frontmatter.budget.monthly_minor };
}

async function monthSpent(scene: Scene, persona: Persona): Promise<boolean> {
  const { tx, harness, context } = scene;
  const spend = await spendThisMonth(tx, harness.id, context.at);
  const monthlyMinor = await monthlyMinorOf(tx, harness.id, persona.monthlyMinor);
  return budgetSpent(spend, assistantRole.turnCeilingMinor, monthlyMinor);
}

async function budgetRefusal(scene: Scene, persona: Persona): Promise<AssistantTurnRefusal | null> {
  if (await monthSpent(scene, persona)) return 'assistant_budget_spent';
  const { tx, settings, context } = scene;
  return (await poolSpent(tx, settings, context.at)) ? 'assistants_capped' : null;
}

async function openTurn(scene: Scene): Promise<StartedTurn | 'finished' | null> {
  const events = await requestEvents(scene.tx, scene.request, [
    'assistant_turn_started',
    'assistant_turn_finished',
  ]);
  if (anyNamed(events, 'assistant_turn_finished')) return 'finished';
  return startedTurn(events, null);
}

function assistFor(
  scene: Scene,
  identity: Identity,
  open: StartedTurn | null,
): Promise<LiveAssist | null> {
  const { tx, ports, context, harness } = scene;
  if (open === null) return liveAssist(tx, ports, context, harness, identity);
  return boundAssist(tx, ports, context, open.delegationId);
}

async function started(scene: Scene, admitted: Admitted, attemptId: string): Promise<Turn> {
  const { tx, context, request } = scene;
  const { persona, assist } = admitted;
  const turnId = context.ids.next();
  const loop = await loopOf(tx, {
    request,
    persona: persona.run,
    at: context.at,
    traceId: context.traceId,
  });
  await recordHarnessEvents(tx, context, request.harnessId, [
    draft('assistant_turn_started', {
      requestId: request.id,
      turnId,
      attemptId,
      delegationId: assist.delegation.id,
      personaVersion: persona.version,
    }),
  ]);
  return { turnId, principal: principalOf(scene, assist), loop };
}

async function replayed(scene: Scene, admitted: Admitted, open: StartedTurn): Promise<Turn> {
  const { tx, context, request } = scene;
  const { persona, assist } = admitted;
  const loop = await loopOf(tx, {
    request,
    persona: persona.run,
    at: open.at,
    traceId: context.traceId,
  });
  return { turnId: open.turnId, principal: principalOf(scene, assist), loop };
}

function principalOf(scene: Scene, assist: LiveAssist): Principal {
  return assistantPrincipal(assist.delegation, assist.grants, scene.context.at);
}

async function admittedOn(
  scene: Scene,
  identity: Identity,
  open: StartedTurn | null,
): Promise<Admitted | AssistantTurnRefusal> {
  const { tx, context, harness } = scene;
  if (harness.paused) return 'harness_paused';
  const assist = await assistFor(scene, identity, open);
  if (assist === null) return 'delegation_required';
  const persona = await activePersona(scene, identity);
  if (persona === null) return 'persona_inactive';
  if ((await spendRefusal(tx, context.at)) !== null) return 'spend_held';
  const spent = open === null ? await budgetRefusal(scene, persona) : null;
  return spent ?? { persona, assist };
}

async function beginIn(
  scene: Scene,
  identity: Identity,
  attemptId: string,
): Promise<KernelOutcome<Turn>> {
  const open = await openTurn(scene);
  if (open === 'finished') return refuseTurn(scene, 'turn_taken');
  if (open !== null && open.attemptId !== attemptId) return refuseTurn(scene, 'turn_taken');
  const admitted = await admittedOn(scene, identity, open);
  if (typeof admitted === 'string') {
    return open === null ? refuseTurn(scene, admitted) : closeTurn(scene, open, admitted);
  }
  if (open !== null) return accepted(await replayed(scene, admitted, open));
  return accepted(await started(scene, admitted, attemptId));
}

async function sceneOf(
  ports: TurnPorts,
  settings: KernelSettings,
  tx: StoreTransaction,
  context: RecordContext,
  requestId: string,
): Promise<Scene | Refused> {
  await tx.lock(lockKeys.assistantRequest(requestId));
  const request = await tx.assistantRequests.read.byId(requestId);
  if (request === null) return refused('malformed_command', { why: 'request_not_found' });
  await tx.lock(lockKeys.assistantHarness(request.harnessId));
  const harness = await tx.harnesses.read.byId(request.harnessId);
  if (harness === null || harness.personId !== request.personId) {
    return refused('harness_not_found', { harnessId: request.harnessId });
  }
  return { tx, ports, settings, context, request, harness };
}

export async function beginTurn(
  ports: TurnPorts,
  settings: KernelSettings,
  caller: Caller,
  input: BeginInput,
): Promise<KernelOutcome<Turn>> {
  if (!isSystemPrincipal(caller.actor)) {
    return refused('not_permitted', { actor: caller.actor.identity });
  }
  if (!uuid.safeParse(input.attemptId).success) {
    return refused('malformed_command', { why: 'attempt_id_not_uuid' });
  }
  const context = recordContext(ports, caller, ports.clock.now());
  return ports.store.transaction(async (tx) => {
    const scene = await sceneOf(ports, settings, tx, context, input.requestId);
    if ('status' in scene) return scene;
    const identity = identitySchema.parse(assistantIdentityOf(scene.request.personId));
    return beginIn(scene, identity, input.attemptId);
  });
}
