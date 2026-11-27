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
};
