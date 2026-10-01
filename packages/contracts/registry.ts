import type { ZodType } from 'zod';
import * as closedSets from './closed-sets.ts';
import { commandNameSchema, commandSchema, overrideCommandSchema } from './commands.ts';
import { grantRoleCommandSchema, revokeRoleCommandSchema } from './acl-commands.ts';
import { jdAreaSchema } from './areas.ts';
import { eventNameSchema, eventSchema } from './events.ts';
import {
  healthIndicatorSchema,
  healthReportSchema,
  indicatorStatusSchema,
  overallStatusSchema,
} from './health.ts';
import { identitySchema } from './identity.ts';
import {
  ingestEnvelopeSchema,
  ingestRefusalSchema,
  ingestResponseSchema,
  ingestSourceSchema,
} from './ingest.ts';
import {
  acceptedOutcomeSchema,
  errorOutcomeSchema,
  errorReasonSchema,
  outcomeSchema,
  refusalSchema,
} from './outcomes.ts';
import {
  createPageCommandSchema,
  frontmatterSchema,
  pageSchema,
  pageStatusSchema,
  pageTypeSchema,
  slugSchema,
  updatePageCommandSchema,
} from './pages.ts';
import {
  dataSourceKindSchema,
  dataSourcesFrontmatterSchema,
  learningFrontmatterSchema,
  personaFrontmatterSchema,
  productFrontmatterSchema,
  productStrategyFrontmatterSchema,
  skillFrontmatterSchema,
  systemGoalFrontmatterSchema,
} from './page-types.ts';
import { platformCommandNameSchema } from './platform-commands.ts';
import { grantSchema, principalSchema } from './principal.ts';
import { runStepSchema, submitToGateResultSchema } from './verb-io.ts';
import { forbiddenVerbSchema, verbNameSchema } from './verb-names.ts';
import { verbGrantSchema, verbGroupSchema } from './verbs.ts';

export const schemaRegistry: Record<string, ZodType> = {
  command: commandSchema,
  'command-name': commandNameSchema,
  'override-command': overrideCommandSchema,
  outcome: outcomeSchema,
  'accepted-outcome': acceptedOutcomeSchema,
  'error-outcome': errorOutcomeSchema,
  'error-reason': errorReasonSchema,
  event: eventSchema,
  'event-name': eventNameSchema,
  identity: identitySchema,
  connector: closedSets.connectorSchema,
  'exit-gate': closedSets.exitGateSchema,
  'agent-pickup': closedSets.agentPickupSchema,
  'risk-tier': closedSets.riskTierSchema,
  'risk-domain': closedSets.riskDomainSchema,
  'risk-domains': closedSets.riskDomainsSchema,
  'evidence-label': closedSets.evidenceLabelSchema,
  role: closedSets.roleSchema,
  scope: closedSets.scopeSchema,
  classification: closedSets.classificationSchema,
  'offline-eligibility': closedSets.offlineEligibilitySchema,
  'run-shape': closedSets.runShapeSchema,
  engine: closedSets.engineSchema,
  'cost-basis': closedSets.costBasisSchema,
  refusal: refusalSchema,
  'capability-word': closedSets.capabilityWordSchema,
  'gate-decision': closedSets.gateDecisionSchema,
  'person-status': closedSets.personStatusSchema,
  'principal-kind': closedSets.principalKindSchema,
  'jd-area': jdAreaSchema,
  grant: grantSchema,
  principal: principalSchema,
  'platform-command-name': platformCommandNameSchema,
  'grant-role-command': grantRoleCommandSchema,
  'revoke-role-command': revokeRoleCommandSchema,
  'indicator-status': indicatorStatusSchema,
  'overall-status': overallStatusSchema,
  'health-indicator': healthIndicatorSchema,
  'health-report': healthReportSchema,
  'page-type': pageTypeSchema,
  'page-status': pageStatusSchema,
  slug: slugSchema,
  frontmatter: frontmatterSchema,
  page: pageSchema,
  'create-page-command': createPageCommandSchema,
  'update-page-command': updatePageCommandSchema,
  'verb-name': verbNameSchema,
  'forbidden-verb': forbiddenVerbSchema,
  'verb-group': verbGroupSchema,
  'verb-grant': verbGrantSchema,
  'submit-to-gate-result': submitToGateResultSchema,
  'run-step': runStepSchema,
  'skill-frontmatter': skillFrontmatterSchema,
  'learning-frontmatter': learningFrontmatterSchema,
  'persona-frontmatter': personaFrontmatterSchema,
  'product-frontmatter': productFrontmatterSchema,
  'system-goal-frontmatter': systemGoalFrontmatterSchema,
  'product-strategy-frontmatter': productStrategyFrontmatterSchema,
  'data-sources-frontmatter': dataSourcesFrontmatterSchema,
  'data-source-kind': dataSourceKindSchema,
  'ingest-source': ingestSourceSchema,
  'ingest-refusal': ingestRefusalSchema,
  'ingest-envelope': ingestEnvelopeSchema,
  'ingest-response': ingestResponseSchema,
};
