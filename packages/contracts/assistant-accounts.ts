import { z } from 'zod';

export const ASSISTANT_JD_CATEGORY = '10';
export const ASSISTANT_JD_FLOOR = 51;
export const ASSISTANT_JD_LAST = 999;
export const ASSISTANT_DELETE_AFTER_DAYS = 30;
export const ASSISTANT_NAME_PATTERN = '^[a-z0-9][a-z0-9.-]{0,28}[a-z0-9]$';
export const ASSISTANT_JD_ID_PATTERN = '^10\\.(5[1-9]|[6-9][0-9]|[1-9][0-9]{2})$';

const namePattern = new RegExp(ASSISTANT_NAME_PATTERN);

export const reservedAssistantNames: ReadonlySet<string> = new Set([
  'abuse',
  'admin',
  'administrator',
  'all',
  'assistant',
  'assistants',
  'billing',
  'bot',
  'everyone',
  'help',
  'hostmaster',
  'info',
  'mail',
  'mailer-daemon',
  'no-reply',
  'noreply',
  'postmaster',
  'root',
  'security',
  'support',
  'system',
  'unfoldingword',
  'webmaster',
]);

export const assistantNameRefusalSchema = z.enum(['name_invalid', 'name_reserved', 'name_taken']);
export const assistantAccountStatusSchema = z.enum(['enabled', 'disabled', 'deleted']);
export const assistantProvisioningStepSchema = z.enum([
  'workspace_user',
  'zulip_bot',
  'persona',
  'assist',
  'suspend_user',
  'deactivate_bot',
  'delete_user',
]);
export const assistantProvisioningStatusSchema = z.enum(['working', 'waiting', 'done', 'failed']);
export const assistantProvisioningFailureSchema = z.enum([
  'name_taken',
  'workspace_refused',
  'workspace_unavailable',
  'workspace_not_wired',
  'zulip_refused',
  'zulip_rate_limited',
  'zulip_unknown',
  'zulip_not_wired',
  'key_not_sealed',
  'persona_refused',
  'person_inactive',
  'step_failed',
]);
export const assistantJdIdSchema = z.string().regex(new RegExp(ASSISTANT_JD_ID_PATTERN));

export type AssistantNameRefusal = z.infer<typeof assistantNameRefusalSchema>;
export type AssistantAccountStatus = z.infer<typeof assistantAccountStatusSchema>;
export type AssistantProvisioningStep = z.infer<typeof assistantProvisioningStepSchema>;
export type AssistantProvisioningStatus = z.infer<typeof assistantProvisioningStatusSchema>;
export type AssistantProvisioningFailure = z.infer<typeof assistantProvisioningFailureSchema>;

export function assistantNameRefusal(name: string): 'name_invalid' | 'name_reserved' | null {
  if (!namePattern.test(name) || name.includes('..')) return 'name_invalid';
  return reservedAssistantNames.has(name) ? 'name_reserved' : null;
}

export function assistantAddressOf(name: string, domain: string): string {
  return `${name}@${domain}`;
}

function itemOf(id: string): number | null {
  if (!assistantJdIdSchema.safeParse(id).success) return null;
  return Number(id.slice(ASSISTANT_JD_CATEGORY.length + 1));
}

export function nextAssistantJdId(taken: Iterable<string>): string | null {
  const used = new Set<number>();
  for (const id of taken) {
    const item = itemOf(id);
    if (item !== null) used.add(item);
  }
  for (let item = ASSISTANT_JD_FLOOR; item <= ASSISTANT_JD_LAST; item += 1) {
    if (!used.has(item)) return `${ASSISTANT_JD_CATEGORY}.${String(item)}`;
  }
  return null;
}

export const enableAssistantCommandSchema = z.strictObject({
  command: z.literal('enable_assistant'),
  requestId: z.uuid(),
  name: z.string().trim().toLowerCase().min(1).max(64),
});

export const disableAssistantCommandSchema = z.strictObject({
  command: z.literal('disable_assistant'),
  requestId: z.uuid(),
});

export const grantAssistCommandSchema = z.strictObject({
  command: z.literal('grant_assist'),
  requestId: z.uuid(),
  expiresAt: z.iso.datetime().nullable(),
});

export type EnableAssistantCommand = z.infer<typeof enableAssistantCommandSchema>;
export type DisableAssistantCommand = z.infer<typeof disableAssistantCommandSchema>;
export type GrantAssistCommand = z.infer<typeof grantAssistCommandSchema>;
