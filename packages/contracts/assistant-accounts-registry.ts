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
};
