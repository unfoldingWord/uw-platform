import { z } from 'zod';
import type { Bindings } from '../../env.ts';
import { httpsOrigin } from '../../notify/origin.ts';
import type { ZulipAdminConfig } from './admin.ts';

export type AssistantZulipConfig = {
  readonly admin: ZulipAdminConfig;
  readonly webhookUrl: string;
};

const WEBHOOK_PATH = '/webhooks/zulip-assistant';
const emailSchema = z.email();

export function assistantZulipConfigOf(env: Bindings): AssistantZulipConfig | null {
  const site = httpsOrigin(env.ZULIP_SITE);
  const base = httpsOrigin(env.ASSISTANT_WEBHOOK_BASE);
  const email = emailSchema.safeParse(env.ZULIP_ADMIN_EMAIL);
  const apiKey = env.ZULIP_ADMIN_API_KEY ?? '';
  if (site === null || base === null || !email.success) return null;
  if (apiKey.length < 1 || apiKey.length > 200) return null;
  return { admin: { site, email: email.data, apiKey }, webhookUrl: `${base}${WEBHOOK_PATH}` };
}
