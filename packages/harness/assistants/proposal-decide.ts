import {
  assistantProposalDecisionSchema,
  harnessSchema,
  proposedEffectOf,
  type AssistantEffectFailure,
  type AssistantProposalDecision,
  type AssistantProposalRefusal,
} from '@uw/contracts';
import type { Caller } from '../caller.ts';
import { draft, recordContext, recordHarnessEvents, type RecordContext } from '../items/record.ts';
import { lockKeys } from '../lock-keys.ts';
import { accepted, refused, type KernelOutcome, type Refused } from '../outcome.ts';
import type {
  AssistantEffectRow,
  AssistantProposalRow,
  Ports,
  StoreTransaction,
} from '../ports.ts';
import { executeProposal, type Execution } from './proposal-execute.ts';
import { ownedHarness } from './settings.ts';

export type ProposalDecideInput = {
  readonly proposalId: string;
  readonly decision: AssistantProposalDecision;
  readonly digest: string;
};
export type ProposalDecided = {
  readonly proposalId: string;
  readonly decision: AssistantProposalDecision;
  readonly effectId: string | null;
  readonly failure: AssistantEffectFailure | null;
};

type DecidePorts = Pick<Ports, 'clock' | 'grants' | 'ids' | 'store' | 'workspace' | 'pageAppends'>;
type Plan = { readonly done: ProposalDecided } | { readonly run: Execution };

const DIGEST = /^[0-9a-f]{64}$/;

function notDecidable(why: AssistantProposalRefusal, proposalId: string): Refused {
  return refused('proposal_not_decidable', { why, proposalId });
}

async function expiredIn(
  tx: StoreTransaction,
  context: RecordContext,
  proposal: AssistantProposalRow,
): Promise<Refused> {
  if (await tx.assistantProposals.write.expire({ id: proposal.id, at: context.at })) {
    await recordHarnessEvents(tx, context, proposal.harnessId, [
      draft('assistant_proposal_expired', { proposalId: proposal.id }),
    ]);
  }
  return notDecidable('proposal_expired', proposal.id);
}

async function startedEffect(
  tx: StoreTransaction,
  context: RecordContext,
  proposal: AssistantProposalRow,
): Promise<AssistantEffectRow> {
  const effect: AssistantEffectRow = {
    id: context.ids.next(),
    harnessId: proposal.harnessId,
    requestId: proposal.requestId,
    kind: proposedEffectOf(proposal.kind),
    idempotencyKey: `proposal:${proposal.id}`,
    payload: { proposalId: proposal.id },
    createdAt: context.at,
    proposalId: proposal.id,
  };
  if (!(await tx.assistantEffects.write.insert(effect))) {
    throw new Error('the effect of a proposal decided once is already taken');
  }
  await recordHarnessEvents(tx, context, proposal.harnessId, [
    draft('assistant_effect_started', {
      effectId: effect.id,
      requestId: proposal.requestId,
      kind: effect.kind,
    }),
  ]);
  return effect;
}

async function decidedIn(
  tx: StoreTransaction,
  context: RecordContext,
  proposal: AssistantProposalRow,
  input: ProposalDecideInput,
): Promise<Plan | Refused> {
  const status = input.decision === 'accept' ? 'accepted' : 'declined';
  const decision = {
    id: proposal.id,
    status,
    decidedBy: context.actor,
    digest: input.digest,
    at: context.at,
  } as const;
  if (!(await tx.assistantProposals.write.decide(decision))) {
    return notDecidable('proposal_changed', proposal.id);
  }
  await recordHarnessEvents(tx, context, proposal.harnessId, [
    draft('assistant_proposal_decided', {
      proposalId: proposal.id,
      kind: proposal.kind,
      decision: input.decision,
    }),
  ]);
  const done = { proposalId: proposal.id, decision: input.decision, failure: null };
  if (status === 'declined') return { done: { ...done, effectId: null } };
  const effect = await startedEffect(tx, context, proposal);
  const settings = await tx.assistantSettings.read.byHarness(proposal.harnessId);
  const assistantName = settings?.displayName ?? 'Assistant';
  return { run: { proposal, effect, assistantName, at: context.at } };
}

async function planIn(
  ports: DecidePorts,
  tx: StoreTransaction,
  context: RecordContext,
  caller: Caller,
  input: ProposalDecideInput,
): Promise<Plan | Refused> {
  const found = await tx.assistantProposals.read.byId(input.proposalId);
  if (found === null) return notDecidable('proposal_not_found', input.proposalId);
  const owned = await ownedHarness(ports, tx, caller, found.harnessId, context.at);
  if ('status' in owned) return owned;
  await tx.lock(lockKeys.assistantHarness(found.harnessId));
  const proposal = await tx.assistantProposals.read.byId(found.id);
  if (proposal === null || proposal.personId !== owned.personId) {
    return notDecidable('proposal_not_found', input.proposalId);
  }
  if (proposal.status === 'expired') return notDecidable('proposal_expired', proposal.id);
  if (proposal.status !== 'pending') return notDecidable('already_decided', proposal.id);
  if (proposal.expiresAt.getTime() <= context.at.getTime()) {
    return expiredIn(tx, context, proposal);
  }
  if (proposal.digest !== input.digest) return notDecidable('proposal_changed', proposal.id);
  return decidedIn(tx, context, proposal, input);
}

async function settleIn(
  ports: DecidePorts,
  caller: Caller,
  run: Execution,
  failure: AssistantEffectFailure | null,
): Promise<ProposalDecided> {
  const { effect, proposal } = run;
  const context = recordContext(ports, caller, ports.clock.now());
  await ports.store.transaction(async (tx) => {
    await tx.lock(lockKeys.assistantHarness(proposal.harnessId));
    const settled =
      failure === null
        ? draft('assistant_effect_done', { effectId: effect.id, kind: effect.kind })
        : draft('assistant_effect_failed', {
            effectId: effect.id,
            kind: effect.kind,
            why: failure,
          });
    await recordHarnessEvents(tx, context, proposal.harnessId, [settled]);
  });
  return { proposalId: proposal.id, decision: 'accept', effectId: effect.id, failure };
}

async function executed(
  ports: DecidePorts,
  caller: Caller,
  run: Execution,
): Promise<AssistantEffectFailure | null> {
  try {
    return await executeProposal(ports, caller, run);
  } catch {
    return 'outcome_unknown';
  }
}

function malformed(input: ProposalDecideInput): Refused | null {
  if (!harnessSchema.shape.id.safeParse(input.proposalId).success) {
    return refused('malformed_command', { field: 'proposalId' });
  }
  if (!assistantProposalDecisionSchema.safeParse(input.decision).success) {
    return refused('malformed_command', { field: 'decision' });
  }
  return DIGEST.test(input.digest) ? null : refused('malformed_command', { field: 'digest' });
}

export async function decideProposal(
  ports: DecidePorts,
  caller: Caller,
  input: ProposalDecideInput,
): Promise<KernelOutcome<ProposalDecided>> {
  const unfit = malformed(input);
  if (unfit !== null) return unfit;
  const context = recordContext(ports, caller, ports.clock.now());
  const plan = await ports.store.transaction((tx) => planIn(ports, tx, context, caller, input));
  if ('status' in plan) return plan;
  if ('done' in plan) return accepted(plan.done);
  const failure = await executed(ports, caller, plan.run);
  return accepted(await settleIn(ports, caller, plan.run, failure));
}
