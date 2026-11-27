import { proposalLink } from '@uw/contracts';
import type { Ports } from '../ports.ts';

const KIND_WORDS = { email: 'an email', invite: 'an invitation', page_append: 'a page addition' };

export async function proposalNotes(
  ports: Pick<Ports, 'store'>,
  requestId: string,
  appOrigin: string | null,
): Promise<readonly string[]> {
  const proposals = await ports.store.transaction((tx) =>
    tx.assistantProposals.read.forRequest(requestId),
  );
  const pending = proposals.filter((proposal) => proposal.status === 'pending');
  if (pending.length === 0) return [];
  const lines = pending.map(
    (proposal) => `- ${KIND_WORDS[proposal.kind]}: ${appOrigin ?? ''}${proposalLink(proposal.id)}`,
  );
  const heading =
    pending.length === 1
      ? 'I prepared a proposal for you to decide. Nothing is sent or written until you accept it on My Assistant within seven days:'
      : `I prepared ${String(pending.length)} proposals for you to decide. Nothing is sent or written until you accept each on My Assistant within seven days:`;
  return [[heading, ...lines].join('\n')];
}
