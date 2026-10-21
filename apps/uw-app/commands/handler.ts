import type { z } from 'zod';
import {
  harnessCommandSchemas,
  type CommandBody,
  type CommandName,
  type Harness,
  type Principal,
  type Stage,
} from '@uw/contracts';
import type { AclAction } from '@uw/core/acl';
import type { Caller, Kernel, KernelOutcome } from '@uw/harness';
import type { CommandResult } from '../http/commands.ts';
import type { CommandCapabilities } from './capabilities.ts';

export type CommandContext = CommandCapabilities & {
  readonly kernel: Kernel;
  readonly caller: Caller;
  readonly harnessId: string;
  readonly harness: Harness | null;
  readonly stages: readonly Stage[];
};

export type CommandScope = 'harness' | 'new_harness';
type AgentRule = 'refused' | 'recorded';

export type CommandHandler = {
  readonly name: CommandName;
  readonly action: AclAction;
  readonly scope: CommandScope;
  readonly agents: AgentRule;
  readonly ownerMayRevoke: boolean;
  readonly run: (context: CommandContext, body: unknown) => Promise<CommandResult>;
};

type CommandSpec<Name extends CommandName> = {
  readonly name: Name;
  readonly action: AclAction;
  readonly scope?: CommandScope;
  readonly agents?: AgentRule;
  readonly ownerMayRevoke?: boolean;
  readonly run: (context: CommandContext, body: CommandBody<Name>) => Promise<CommandResult>;
};

const gateCommands: ReadonlySet<CommandName> = new Set<CommandName>([
  'approve',
  'decide_gates',
  'reject',
  'take_over',
  'override',
  'recover_connectors',
]);

type BodySchemas = { readonly [Name in CommandName]: z.ZodType<CommandBody<Name>> };
const bodySchemas: BodySchemas = harnessCommandSchemas;

const agentRecorded: ReadonlySet<CommandName> = new Set<CommandName>([
  'approve',
  'reject',
  'take_over',
  'override',
]);

const built = new WeakSet<CommandHandler>();

function brandCommand(handler: CommandHandler): CommandHandler {
  const frozen = Object.freeze({ ...handler });
  built.add(frozen);
  return frozen;
}

export function isBuiltCommand(handler: CommandHandler): boolean {
  return built.has(handler);
}

export function isHumanPrincipal(principal: Principal): boolean {
  const { kind, personId, identity } = principal;
  return kind === 'person' && personId !== null && identity === `human:${personId}`;
}

export function opensGateGitHub(handler: CommandHandler): boolean {
  return gateCommands.has(handler.name);
}

export function commandHandler<Name extends CommandName>(spec: CommandSpec<Name>): CommandHandler {
  const schema = bodySchemas[spec.name];
  if (spec.agents === 'recorded' && !agentRecorded.has(spec.name)) {
    throw new TypeError(`the ${spec.name} command may not let an agent reach the kernel`);
  }
  if (spec.ownerMayRevoke === true && spec.name !== 'revoke_delegation') {
    throw new TypeError(`the ${spec.name} command may not waive admin for an owner`);
  }
  return brandCommand({
    name: spec.name,
    action: spec.action,
    scope: spec.scope ?? 'harness',
    agents: spec.agents ?? 'refused',
    ownerMayRevoke: spec.ownerMayRevoke ?? false,
    run: async (context, body) => spec.run(context, schema.parse(body)),
  });
}

export function fromKernel<T>(outcome: KernelOutcome<T>): CommandResult {
  if (outcome.status === 'accepted') return { ok: true };
  return { ok: false, reason: outcome.reason };
}
