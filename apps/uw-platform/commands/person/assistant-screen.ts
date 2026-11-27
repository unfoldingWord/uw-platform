import {
  assistantIdentityOf,
  type CustomiseAssistantCommand,
  type RenewAssistCommand,
  type UndoAssistantEffectCommand,
} from '@uw/contracts';
import type { KernelOutcome } from '@uw/harness';
import type { CommandResult } from '../../http/commands.ts';
import type { AssistantCommandDeps } from './assistant.ts';

function resultOf(outcome: KernelOutcome<unknown>): CommandResult {
  return outcome.status === 'accepted' ? { ok: true } : { ok: false, reason: outcome.reason };
}

async function mine(deps: AssistantCommandDeps) {
  const seen = await deps.kernel.views.myAssistant(deps.caller, { personId: null });
  if (seen.status !== 'accepted' || seen.value.harnessId === null) return null;
  return { ...seen.value, harnessId: seen.value.harnessId };
}

export async function customiseAssistant(
  deps: AssistantCommandDeps,
  command: CustomiseAssistantCommand,
): Promise<CommandResult> {
  const held = await mine(deps);
  if (held === null) return { ok: false, reason: 'no_assistant' };
  const { displayName, instructionsMd, timezone, expectedVersion } = command;
  return resultOf(
    await deps.kernel.assistants.customise(deps.caller, {
      harnessId: held.harnessId,
      settings: { displayName, instructionsMd, timezone },
      expectedVersion,
    }),
  );
}

export async function renewAssist(
  deps: AssistantCommandDeps,
  command: RenewAssistCommand,
): Promise<CommandResult> {
  const held = await mine(deps);
  const personId = deps.caller.actor.personId;
  if (held === null || personId === null || held.account?.status === 'disabled') {
    return { ok: false, reason: 'no_assistant' };
  }
  const outcome = await deps.kernel.delegations.grant(deps.caller, {
    harnessId: held.harnessId,
    persona: assistantIdentityOf(personId),
    capability: 'assist',
    maxTier: null,
    expiresAt: command.expiresAt === null ? null : new Date(command.expiresAt),
    supersedes: held.assist?.delegationId ?? null,
  });
  if (outcome.status === 'accepted') await deps.drive(held.harnessId);
  return resultOf(outcome);
}

export async function revokeAssist(deps: AssistantCommandDeps): Promise<CommandResult> {
  const held = await mine(deps);
  if (held === null) return { ok: false, reason: 'no_assistant' };
  if (held.assist === null) return { ok: false, reason: 'delegation_not_found' };
  const { delegationId } = held.assist;
  return resultOf(await deps.kernel.delegations.revoke(deps.caller, { delegationId }));
}

export async function undoAssistantEffect(
  deps: AssistantCommandDeps,
  command: UndoAssistantEffectCommand,
): Promise<CommandResult> {
  return resultOf(
    await deps.kernel.assistants.undoEffect(deps.caller, { effectId: command.effectId }),
  );
}

export async function deleteMyAssistantHistory(deps: AssistantCommandDeps): Promise<CommandResult> {
  return resultOf(await deps.kernel.assistants.redactHistory(deps.caller, {}));
}
