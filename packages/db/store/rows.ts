import {
  capabilityWordSchema,
  eventSchema,
  gateDecisionSchema,
  identitySchema,
  harnessSchema,
  itemStateSchema,
  stageSchema,
  type Harness,
  type HarnessEvent,
  type ItemState,
  type Stage,
} from '@uw/contracts';
import type {
  delegations,
  gateDecisions,
  harnessEvents,
  harnessItems,
  harnessStages,
  harnesses,
} from '../schema.ts';
import type { Delegation, GateDecisionRow } from './types.ts';

export function toHarness(row: typeof harnesses.$inferSelect): Harness {
  return harnessSchema.parse({
    id: row.id,
    key: row.key,
    template: row.template,
    jdArea: row.jdArea,
    repository: row.repository,
    hostedBuilderEnabled: row.hostedBuilderEnabled,
    paused: row.paused,
  });
}

export function toStage(row: typeof harnessStages.$inferSelect): Stage {
  return stageSchema.parse({
    id: row.id,
    harnessId: row.harnessId,
    key: row.key,
    title: row.title,
    position: row.position,
    bracket: row.bracket,
    agentPickup: row.agentPickup,
    exitGate: row.exitGate,
    connector: row.connector,
    wipLimit: row.wipLimit,
    instructionsPageId: row.instructionsPageId,
    validators: row.validators,
    feeds: row.feeds,
    paused: row.paused,
  });
}

function issueOf(row: typeof harnessItems.$inferSelect) {
  if (row.issueRepo === null || row.issueNumber === null || row.issueGithubId === null) return null;
  return { repo: row.issueRepo, number: row.issueNumber, githubId: row.issueGithubId };
}

export function toItemState(row: typeof harnessItems.$inferSelect, stageKey: string): ItemState {
  return itemStateSchema.parse({
    itemId: row.id,
    harnessId: row.harnessId,
    stageKey,
    title: row.title,
    pageId: row.pageId,
    priority: row.priority,
    due: row.due,
    holder: row.claimedBy,
    claimantKind: row.claimantKind,
    delegationId: row.delegationId,
    leaseExpiresAt: row.leaseExpires?.toISOString() ?? null,
    gateStatus: row.gateStatus,
    gateTarget: row.gateTarget,
    branchState: row.branchState,
    expectedHead: row.expectedHead,
    riskTier: row.riskTier,
    riskDomains: row.riskDomains,
    pullRequest:
      row.prRepo === null || row.prNumber === null
        ? null
        : { repo: row.prRepo, number: row.prNumber },
    issue: issueOf(row),
    zulipTopic: row.zulipTopic,
  });
}

export function toEvent(row: typeof harnessEvents.$inferSelect): HarnessEvent {
  return eventSchema.parse({
    eventId: row.id,
    harnessId: row.harnessId,
    itemId: row.itemId,
    name: row.name,
    at: row.at.toISOString(),
    actor: row.actor,
    evidence: row.evidence,
    traceId: row.traceId,
    position: row.position,
  });
}

export function toDelegation(row: typeof delegations.$inferSelect): Delegation {
  return {
    id: row.id,
    personId: row.personId,
    persona: identitySchema.parse(row.persona),
    harnessId: row.harnessId,
    capability: capabilityWordSchema.parse(row.capability),
    grantedAt: row.grantedAt,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    lapsedAt: row.lapsedAt,
    supersedes: row.supersedes,
  };
}

export function toGateDecision(row: typeof gateDecisions.$inferSelect): GateDecisionRow {
  return {
    id: row.id,
    harnessId: row.harnessId,
    itemId: row.itemId,
    stageId: row.stageId,
    actor: identitySchema.parse(row.actor),
    decision: gateDecisionSchema.parse(row.decision),
    reason: row.reason,
    evidence: eventSchema.shape.evidence.parse(row.evidence),
    traceId: row.traceId,
    decidedAt: row.decidedAt,
  };
}
