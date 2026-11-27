import type { AssistantProposalKind, AssistantProposalStatus } from '@uw/contracts';
import type { RedactQuery } from './store-ports-assistants.ts';

export type AssistantProposalPayload = Readonly<Record<string, unknown>>;
export type AssistantProposalRow = {
  readonly id: string;
  readonly harnessId: string;
  readonly personId: string;
  readonly requestId: string;
  readonly kind: AssistantProposalKind;
  readonly payload: AssistantProposalPayload;
  readonly digest: string;
  readonly status: AssistantProposalStatus;
  readonly decidedBy: string | null;
  readonly decidedAt: Date | null;
  readonly expiresAt: Date;
  readonly createdAt: Date;
  readonly redactedAt: Date | null;
};
export type NewAssistantProposal = Pick<
  AssistantProposalRow,
  'id' | 'harnessId' | 'personId' | 'requestId' | 'kind' | 'payload' | 'expiresAt' | 'createdAt'
>;
export type ProposalDecision = {
  readonly id: string;
  readonly status: 'accepted' | 'declined';
  readonly decidedBy: string;
  readonly digest: string;
  readonly at: Date;
};
export type ProposalExpiry = { readonly id: string; readonly at: Date };
export type AssistantProposalsGateway = {
  readonly read: {
    byId(proposalId: string): Promise<AssistantProposalRow | null>;
    forRequest(requestId: string): Promise<readonly AssistantProposalRow[]>;
    recent(harnessId: string, limit: number): Promise<readonly AssistantProposalRow[]>;
    countSince(harnessId: string, since: Date): Promise<number>;
    expiring(at: Date, limit: number): Promise<readonly AssistantProposalRow[]>;
  };
  readonly write: {
    insert(row: NewAssistantProposal): Promise<AssistantProposalRow>;
    decide(decision: ProposalDecision): Promise<boolean>;
    expire(expiry: ProposalExpiry): Promise<boolean>;
    redact(query: RedactQuery): Promise<number>;
  };
};
