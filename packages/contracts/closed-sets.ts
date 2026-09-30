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
