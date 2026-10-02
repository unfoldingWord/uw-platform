import { z } from 'zod';

export const connectorSchema = z.enum(['none', 'merge', 'deploy', 'publish', 'send', 'post']);
export const exitGateSchema = z.enum(['none', 'checks', 'human_approval']);
export const agentPickupSchema = z.enum(['none', 'allowed', 'auto']);
export const riskTierSchema = z.enum(['low', 'standard', 'high']);
export const riskDomainSchema = z.enum(['ledger', 'acl', 'infra', 'migration']);
export const riskDomainsSchema = z
  .array(riskDomainSchema)
  .refine((domains) => new Set(domains).size === domains.length, 'risk domains are a set');
export const evidenceLabelSchema = z.enum(['observed', 'confirmed', 'inferred', 'assumed']);
export const roleSchema = z.enum(['admin', 'editor', 'viewer']);
export const scopeSchema = z.enum(['org', 'jd_area']);
export const classificationSchema = z.enum(['public', 'internal', 'restricted', 'sensitive']);
export const offlineEligibilitySchema = z.enum(['sync', 'cache_readonly', 'never']);
export const runShapeSchema = z.enum(['workflow-run', 'external-run']);
export const engineSchema = z.enum([
  'claude-messages',
  'claude-code-sandbox',
  'claude-managed-agent',
  'codex-sandbox',
  'external',
  'openrouter-messages',
]);
export const costBasisSchema = z.enum(['metered', 'subscription']);
export const capabilityWordSchema = z.enum(['none', 'iterate', 'build', 'review']);
export const gateDecisionSchema = z.enum(['approve', 'reject', 'take_over', 'override']);
export const personStatusSchema = z.enum(['active', 'pending']);
export const principalKindSchema = z.enum(['person', 'agent']);

export type Connector = z.infer<typeof connectorSchema>;
export type ExitGate = z.infer<typeof exitGateSchema>;
export type AgentPickup = z.infer<typeof agentPickupSchema>;
export type RiskTier = z.infer<typeof riskTierSchema>;
export type RiskDomain = z.infer<typeof riskDomainSchema>;
export type RiskDomains = z.infer<typeof riskDomainsSchema>;
export type EvidenceLabel = z.infer<typeof evidenceLabelSchema>;
export type Role = z.infer<typeof roleSchema>;
export type Scope = z.infer<typeof scopeSchema>;
export type Classification = z.infer<typeof classificationSchema>;
export type OfflineEligibility = z.infer<typeof offlineEligibilitySchema>;
export type RunShape = z.infer<typeof runShapeSchema>;
export type Engine = z.infer<typeof engineSchema>;
export type CostBasis = z.infer<typeof costBasisSchema>;
export type CapabilityWord = z.infer<typeof capabilityWordSchema>;
export type GateDecision = z.infer<typeof gateDecisionSchema>;
export type PersonStatus = z.infer<typeof personStatusSchema>;
export type PrincipalKind = z.infer<typeof principalKindSchema>;

export const stageBracketSchema = z.enum([
  'product_package',
  'build_package',
  'deploy_package',
  'iterate',
]);
export const gateStatusSchema = z.enum(['working', 'parked', 'checks_failed', 'done']);
export const branchStateSchema = z.enum(['none', 'active', 'abandoned']);
export const runOutcomeSchema = z.enum(['running', 'hibernated', 'stopped', 'completed', 'failed']);
export const delegationLapseSchema = z.enum(['expired', 'revoked', 'grant_lost']);

export type StageBracket = z.infer<typeof stageBracketSchema>;
export type GateStatus = z.infer<typeof gateStatusSchema>;
export type BranchState = z.infer<typeof branchStateSchema>;
export type RunOutcome = z.infer<typeof runOutcomeSchema>;
export type DelegationLapse = z.infer<typeof delegationLapseSchema>;
