import {
  assistantIdentityOf,
  type EnableAssistantCommand,
  type GrantAssistCommand,
} from '@uw/contracts';
import type { Caller, Kernel, KernelOutcome } from '@uw/harness';
import type { CommandResult } from '../../http/commands.ts';

type HeldAssistant = {
  readonly harnessId: string;
  readonly name: string;
  readonly live: boolean;
};

export type AssistantCommandDeps = {
  readonly kernel: Kernel;
  readonly caller: Caller;
  readonly held: () => Promise<HeldAssistant | null>;
  readonly nameTaken: (name: string) => Promise<boolean>;
  readonly drive: (harnessId: string) => Promise<void>;
};

function resultOf(outcome: KernelOutcome<unknown>): CommandResult {
  return outcome.status === 'accepted' ? { ok: true } : { ok: false, reason: outcome.reason };
}

export async function enableAssistant(
  deps: AssistantCommandDeps,
  command: EnableAssistantCommand,
): Promise<CommandResult> {
  if (await deps.nameTaken(command.name)) return { ok: false, reason: 'assistant_name_taken' };
  const input = { harnessId: crypto.randomUUID(), name: command.name };
  const outcome = await deps.kernel.assistants.enable(deps.caller, input);
  if (outcome.status === 'accepted') await deps.drive(outcome.value.harnessId);
  return resultOf(outcome);
}

export async function disableAssistant(deps: AssistantCommandDeps): Promise<CommandResult> {
  const outcome = await deps.kernel.assistants.disable(deps.caller, {});
  if (outcome.status === 'accepted') await deps.drive(outcome.value.harnessId);
  return resultOf(outcome);
}

export async function grantAssist(
  deps: AssistantCommandDeps,
  command: GrantAssistCommand,
): Promise<CommandResult> {
  const personId = deps.caller.actor.personId;
  const held = await deps.held();
  if (personId === null || held === null || !held.live)
    return { ok: false, reason: 'no_assistant' };
  const outcome = await deps.kernel.delegations.grant(deps.caller, {
    harnessId: held.harnessId,
    persona: assistantIdentityOf(personId),
    capability: 'assist',
    maxTier: null,
    expiresAt: command.expiresAt === null ? null : new Date(command.expiresAt),
    supersedes: null,
  });
  if (outcome.status === 'accepted') await deps.drive(held.harnessId);
  return resultOf(outcome);
}
