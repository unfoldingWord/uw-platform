import { z } from 'zod';
import {
  commandNameSchema,
  harnessCommandSchemas,
  type CommandName,
  type ErrorReason,
  type Outcome,
  type Principal,
  type Refusal,
} from '@uw/contracts';
import { can } from '@uw/core/acl';
import type { Logger } from '@uw/core/log';
import type { Caller, Clock, Hub, Kernel, Notifier, Runs } from '@uw/harness';
import type { DatabaseHandle } from '../database.ts';
import { malformedOutcome, toOutcome } from '../http/commands.ts';
import { hubWiring, platformKernel } from '../kernel.ts';
import type { ShipGitHub } from '../ports/connectors.ts';
import { commandCapabilities, type GateAccess } from './capabilities.ts';
import {
  isBuiltCommand,
  isHumanPrincipal,
  opensGateGitHub,
  type CommandContext,
  type CommandHandler,
} from './handler.ts';
import { claimRequest, priorRequest, releaseRequest, settleRequest } from './requests.ts';
import { foreignTarget, sceneOf, type Scene } from './scope.ts';

export type CommandRequest = {
  readonly name: string;
  readonly harness: string;
  readonly body: unknown;
  readonly principal: Principal | null;
  readonly traceId: string;
  readonly at: Date;
};

export type DispatchScope = {
  readonly database: DatabaseHandle | null;
  readonly registry: ReadonlyMap<CommandName, CommandHandler>;
  readonly gateGitHub: () => ShipGitHub | null;
  readonly hub: Hub;
  readonly runs: Runs;
  readonly notifier: Notifier;
  readonly logger: Logger;
};

type Reply = Outcome | Refusal;

type Lookup = { readonly kernel: Kernel; readonly caller: Caller; readonly at: Date };

type Admitted = {
  readonly handler: CommandHandler;
  readonly database: DatabaseHandle;
  readonly principal: Principal;
  readonly harnessId: string;
  readonly requestId: string;
  readonly body: unknown;
  readonly traceId: string;
  readonly at: Date;
};

const harnessParam = z.uuid();

function error(requestId: string, reason: ErrorReason): Outcome {
  return { status: 'error', requestId, reason };
}

function handlerFor(scope: DispatchScope, name: string): CommandHandler | null {
  const parsed = commandNameSchema.safeParse(name);
  const handler = parsed.success ? (scope.registry.get(parsed.data) ?? null) : null;
  if (handler !== null && !isBuiltCommand(handler)) {
    throw new TypeError(`the ${handler.name} command handler was not built by commandHandler`);
  }
  return handler;
}

function admitted(
  request: CommandRequest,
  handler: CommandHandler,
  database: DatabaseHandle,
  principal: Principal,
): Admitted | Reply {
  const parsed = harnessCommandSchemas[handler.name].safeParse(request.body);
  if (!parsed.success) return malformedOutcome(request.body);
  const { requestId } = parsed.data;
  const harness = harnessParam.safeParse(request.harness);
  if (!harness.success) return error(requestId, 'harness_not_found');
  const { traceId, at } = request;
  const body = parsed.data;
  return { handler, database, principal, harnessId: harness.data, requestId, body, traceId, at };
}

function permitted(command: Admitted, scene: Scene): boolean {
  if (command.principal.kind !== 'person') return command.handler.agents === 'recorded';
  const resource = { kind: 'area', area: scene.area } as const;
  return can(command.principal, command.handler.action, resource, command.at);
}

const namedDelegation = z.object({ delegationId: z.uuid() });

async function ownerRevokes(lookup: Lookup, command: Admitted): Promise<boolean> {
  const named = namedDelegation.safeParse(command.body);
  if (!command.handler.ownerMayRevoke || !named.success) return false;
  if (!isHumanPrincipal(command.principal)) return false;
  const { delegationId } = named.data;
  const read = await lookup.kernel.reads.delegation(
    lookup.caller,
    { delegationId },
    { at: lookup.at },
  );
  return (
    read.status === 'accepted' && read.value.owned && read.value.harnessId === command.harnessId
  );
}

function replayed(
  command: Admitted,
  prior: Awaited<ReturnType<typeof priorRequest>>,
): Outcome | null {
  if (prior.kind === 'none') return null;
  if (prior.command !== command.handler.name || prior.harnessId !== command.harnessId) {
    return error(command.requestId, 'malformed_command');
  }
  return prior.kind === 'settled' ? prior.outcome : null;
}

function ledgerKey(command: Admitted) {
  return { actor: command.principal.identity, requestId: command.requestId };
}

async function runClaimed(command: Admitted, context: CommandContext): Promise<Outcome> {
  const { db } = command.database;
  const key = ledgerKey(command);
  const result = await command.handler.run(context, command.body).catch(async (thrown: unknown) => {
    await releaseRequest(db, key, command.traceId);
    throw thrown;
  });
  const outcome = toOutcome(command.requestId, result);
  await settleRequest(db, key, { outcome, traceId: command.traceId, at: command.at });
  return outcome;
}

async function runOnce(command: Admitted, context: CommandContext): Promise<Outcome> {
  const { db } = command.database;
  const key = ledgerKey(command);
  const known = replayed(command, await priorRequest(db, key));
  if (known !== null) return known;
  const claim = {
    command: command.handler.name,
    harnessId: command.harnessId,
    traceId: command.traceId,
    at: command.at,
  };
  if (await claimRequest(db, key, claim)) return runClaimed(command, context);
  const after = replayed(command, await priorRequest(db, key));
  return after ?? error(command.requestId, 'request_in_flight');
}

function gateAccess(command: Admitted): GateAccess {
  if (!opensGateGitHub(command.handler)) return 'none';
  return isHumanPrincipal(command.principal) ? 'github' : 'ordinary';
}

function contextOf(
  command: Admitted,
  scope: DispatchScope,
  kernel: Kernel,
  scene: Scene,
  clock: Clock,
): CommandContext {
  const caller: Caller = {
    actor: command.principal,
    traceId: command.traceId,
    requestId: command.requestId,
  };
  const capabilities = commandCapabilities({
    command: command.handler.name,
    database: command.database,
    kernel,
    caller,
    clock,
    live: { hub: scope.hub, runs: scope.runs, notifier: scope.notifier },
    logger: scope.logger,
    gate: gateAccess(command),
    gateGitHub: scope.gateGitHub,
  });
  return {
    ...capabilities,
    kernel,
    caller,
    harnessId: command.harnessId,
    harness: scene.harness,
    stages: scene.stages,
  };
}

async function dispatchAdmitted(command: Admitted, scope: DispatchScope): Promise<Outcome> {
  const clock: Clock = { now: () => command.at };
  const kernel = platformKernel(
    command.database,
    clock,
    hubWiring(scope.hub, { runs: scope.runs, notifier: scope.notifier }),
  );
  const caller: Caller = { actor: command.principal, traceId: command.traceId };
  const lookup = { kernel, caller, at: command.at, db: command.database.db };
  const scene = await sceneOf(lookup, command.handler, command.harnessId, command.body);
  if (typeof scene === 'string') return error(command.requestId, scene);
  if (!permitted(command, scene) && !(await ownerRevokes(lookup, command))) {
    return error(command.requestId, 'not_permitted');
  }
  const foreign = await foreignTarget(lookup, scene, command);
  if (foreign !== null) return error(command.requestId, foreign);
  return runOnce(command, contextOf(command, scope, kernel, scene, clock));
}

export async function executeCommand(
  request: CommandRequest,
  scope: DispatchScope,
): Promise<Reply> {
  const handler = handlerFor(scope, request.name);
  if (handler === null) return { status: 'error', reason: 'not_wired' };
  if (scope.database === null) return { status: 'error', reason: 'database_not_configured' };
  if (request.principal === null) return { status: 'error', reason: 'unauthenticated' };
  const command = admitted(request, handler, scope.database, request.principal);
  if (!('handler' in command)) return command;
  return dispatchAdmitted(command, scope);
}
