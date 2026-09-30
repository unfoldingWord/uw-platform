import type { ZodType } from 'zod';
import * as closedSets from './closed-sets.ts';
import { commandSchema } from './commands.ts';
import { eventSchema } from './events.ts';
import { identitySchema } from './identity.ts';
import { outcomeSchema } from './outcomes.ts';

export const schemaRegistry: Record<string, ZodType> = {
  command: commandSchema,
  outcome: outcomeSchema,
  event: eventSchema,
  identity: identitySchema,
  connector: closedSets.connectorSchema,
  'exit-gate': closedSets.exitGateSchema,
  'agent-pickup': closedSets.agentPickupSchema,
  'risk-tier': closedSets.riskTierSchema,
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
