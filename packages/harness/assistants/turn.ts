import {
  assistantIdentityOf,
  identitySchema,
  type AssistantTurnRefusal,
  type ErrorReason,
  type Harness,
  type Identity,
  type Principal,
} from '@uw/contracts';
import { isSystemPrincipal } from '../access.ts';
import type { Caller } from '../caller.ts';
import { draft, recordContext, recordHarnessEvents, type RecordContext } from '../items/record.ts';
import { lockKeys } from '../lock-keys.ts';
import { accepted, refused, type KernelOutcome, type Refused } from '../outcome.ts';
import { activePersonaOn } from '../personas/projection.ts';
import type { AssistantRequestRow, Ports, StoreTransaction } from '../ports.ts';
import { spendRefusal } from '../runs/breaker-level.ts';
import { personaOfPage, personaPageOf } from '../runs/persona.ts';
import type { RunPersona } from '../runs/types.ts';
import { liveAssist } from './delegation.ts';
import { anyNamed, eventsSince, evidenceNamed } from './ledger.ts';
import { assistantPrincipal } from './principal.ts';
import { assistantRole } from './role.ts';
import { spentThisMonth } from './spend.ts';
import { loopOf, type AssistantLoop } from './loop.ts';

export type Turn = {
  readonly turnId: string;
  readonly principal: Principal;
  readonly loop: AssistantLoop;
};
export type BeginInput = { readonly requestId: string };

type TurnPorts = Pick<Ports, 'clock' | 'grants' | 'ids' | 'store'>;
type Persona = {
  readonly run: RunPersona;
  readonly version: number;
  readonly monthlyMinor: number;
};
type Scene = {
  readonly tx: StoreTransaction;
  readonly ports: TurnPorts;
  readonly context: RecordContext;
  readonly request: AssistantRequestRow;
  readonly harness: Harness;
};

const reasons: ReadonlyMap<AssistantTurnRefusal, ErrorReason> = new Map<
  AssistantTurnRefusal,
  ErrorReason
>([
  ['delegation_required', 'delegation_required'],
  ['persona_inactive', 'not_permitted'],
  ['spend_held', 'spend_held'],
  ['assistant_budget_spent', 'spend_held'],
  ['turn_taken', 'stale_version'],
]);

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

async function budgetSpent(scene: Scene, persona: Persona): Promise<boolean> {
  const { tx, harness, context } = scene;
  const spent = await spentThisMonth(tx, harness.id, context.at, assistantRole.turnCeilingMinor);
  return spent === null || spent >= persona.monthlyMinor;
}

async function turnTaken(scene: Scene): Promise<boolean> {
  const events = await eventsSince(scene.tx, scene.request, ['assistant_turn_started']);
  return anyNamed(evidenceNamed(events, 'requestId', scene.request.id), 'assistant_turn_started');
}

async function started(scene: Scene, persona: Persona, principal: Principal): Promise<Turn> {
  const { tx, context, request } = scene;
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
      personaVersion: persona.version,
    }),
  ]);
  return { turnId, principal, loop };
}

async function beginIn(scene: Scene, identity: Identity): Promise<KernelOutcome<Turn>> {
  const { tx, ports, context, harness } = scene;
  if (await turnTaken(scene)) return refuseTurn(scene, 'turn_taken');
  const assist = await liveAssist(tx, ports, context, harness, identity);
  if (assist === null) return refuseTurn(scene, 'delegation_required');
  const persona = await activePersona(scene, identity);
  if (persona === null) return refuseTurn(scene, 'persona_inactive');
  if ((await spendRefusal(tx, context.at)) !== null) return refuseTurn(scene, 'spend_held');
  if (await budgetSpent(scene, persona)) return refuseTurn(scene, 'assistant_budget_spent');
  const principal = assistantPrincipal(assist.delegation, assist.grants, context.at);
  return accepted(await started(scene, persona, principal));
}

async function sceneOf(
  ports: TurnPorts,
  tx: StoreTransaction,
  context: RecordContext,
  requestId: string,
): Promise<Scene | Refused> {
  await tx.lock(lockKeys.assistantRequest(requestId));
  const request = await tx.assistantRequests.read.byId(requestId);
  if (request === null) return refused('malformed_command', { why: 'request_not_found' });
  const harness = await tx.harnesses.read.byId(request.harnessId);
  if (harness === null || harness.personId !== request.personId) {
    return refused('harness_not_found', { harnessId: request.harnessId });
  }
  return { tx, ports, context, request, harness };
}

export async function beginTurn(
  ports: TurnPorts,
  caller: Caller,
  input: BeginInput,
): Promise<KernelOutcome<Turn>> {
  if (!isSystemPrincipal(caller.actor)) {
    return refused('not_permitted', { actor: caller.actor.identity });
  }
  const context = recordContext(ports, caller, ports.clock.now());
  return ports.store.transaction(async (tx) => {
    const scene = await sceneOf(ports, tx, context, input.requestId);
    if ('status' in scene) return scene;
    const identity = identitySchema.parse(assistantIdentityOf(scene.request.personId));
    return beginIn(scene, identity);
  });
}
