import type { ZodType } from 'zod';
import {
  assistantAccountStatusSchema,
  assistantJdIdSchema,
  assistantNameRefusalSchema,
  assistantProvisioningFailureSchema,
  assistantProvisioningStatusSchema,
  assistantProvisioningStepSchema,
  disableAssistantCommandSchema,
  enableAssistantCommandSchema,
  grantAssistCommandSchema,
} from './assistant-accounts.ts';
import {
  assistantRedactionWhySchema,
  assistantUndoRefusalSchema,
  customiseAssistantCommandSchema,
  deleteMyAssistantHistoryCommandSchema,
  renewAssistCommandSchema,
  revokeAssistCommandSchema,
  undoAssistantEffectCommandSchema,
} from './assistant-history.ts';
import { assistantMailRefusalSchema } from './assistant-mail.ts';
import {
  assistantProposalDecisionSchema,
  assistantProposalKindSchema,
  assistantProposalRefusalSchema,
  assistantProposalStatusSchema,
  decideAssistantProposalCommandSchema,
} from './assistant-proposals.ts';
import { assistantProposedEffectSchema } from './assistants.ts';

export const assistantAccountSchemaRegistry: Record<string, ZodType> = {
  'assistant-account-status': assistantAccountStatusSchema,
  'assistant-name-refusal': assistantNameRefusalSchema,
  'assistant-jd-id': assistantJdIdSchema,
  'assistant-provisioning-step': assistantProvisioningStepSchema,
  'assistant-provisioning-status': assistantProvisioningStatusSchema,
  'assistant-provisioning-failure': assistantProvisioningFailureSchema,
  'enable-assistant-command': enableAssistantCommandSchema,
  'disable-assistant-command': disableAssistantCommandSchema,
  'grant-assist-command': grantAssistCommandSchema,
  'assistant-redaction-why': assistantRedactionWhySchema,
  'assistant-undo-refusal': assistantUndoRefusalSchema,
  'customise-assistant-command': customiseAssistantCommandSchema,
  'renew-assist-command': renewAssistCommandSchema,
  'revoke-assist-command': revokeAssistCommandSchema,
  'undo-assistant-effect-command': undoAssistantEffectCommandSchema,
  'delete-my-assistant-history-command': deleteMyAssistantHistoryCommandSchema,
  'assistant-mail-refusal': assistantMailRefusalSchema,
  'assistant-proposal-kind': assistantProposalKindSchema,
  'assistant-proposal-status': assistantProposalStatusSchema,
  'assistant-proposal-decision': assistantProposalDecisionSchema,
  'assistant-proposal-refusal': assistantProposalRefusalSchema,
  'assistant-proposed-effect': assistantProposedEffectSchema,
  'decide-assistant-proposal-command': decideAssistantProposalCommandSchema,
};
