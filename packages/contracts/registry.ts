import type { ZodType } from 'zod';
import * as closedSets from './closed-sets.ts';
import { commandNameSchema, commandSchema, overrideCommandSchema } from './commands.ts';
import { eventNameSchema, eventSchema } from './events.ts';
import { identitySchema } from './identity.ts';
import {
  acceptedOutcomeSchema,
  errorOutcomeSchema,
  errorReasonSchema,
  outcomeSchema,
} from './outcomes.ts';

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
};
