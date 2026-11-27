import type { DecideAssistantProposalCommand } from '@uw/contracts';
import type { CommandResult } from '../../http/commands.ts';
import type { AssistantCommandDeps } from './assistant.ts';

export async function decideAssistantProposal(
  deps: AssistantCommandDeps,
  command: DecideAssistantProposalCommand,
): Promise<CommandResult> {
  const decided = await deps.kernel.assistants.decideProposal(deps.caller, {
    proposalId: command.proposalId,
    decision: command.decision,
    digest: command.digest,
  });
  return decided.status === 'accepted' ? { ok: true } : { ok: false, reason: decided.reason };
}
