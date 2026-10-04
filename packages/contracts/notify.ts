import { z } from 'zod';
import { wakeReasonSchema } from './closed-sets.ts';
import { slugSchema } from './pages.ts';

const uuidPart = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const deepLinkPattern = new RegExp(`^/(?:harnesses/${uuidPart}/(?:gates|items)/${uuidPart})?$`);

export const deepLinkSchema = z.string().max(100).regex(deepLinkPattern);
export type DeepLink = z.infer<typeof deepLinkSchema>;

export const homeLink: DeepLink = '/';
export function gateLink(harnessId: string, itemId: string): DeepLink {
  return deepLinkSchema.parse(`/harnesses/${harnessId}/gates/${itemId}`);
}
export function itemLink(harnessId: string, itemId: string): DeepLink {
  return deepLinkSchema.parse(`/harnesses/${harnessId}/items/${itemId}`);
}

export const pushPayloadSchema = z.strictObject({
  harness: slugSchema,
  reason: wakeReasonSchema,
  link: deepLinkSchema,
});
export type PushPayload = z.infer<typeof pushPayloadSchema>;

const pushHosts = new Set([
  'fcm.googleapis.com',
  'updates.push.services.mozilla.com',
  'web.push.apple.com',
]);

const httpsPrefix = 'https://';
const windowsSuffix = '.notify.windows.com';

function authorityOf(value: string): string | null {
  if (!value.startsWith(httpsPrefix)) return null;
  const rest = value.slice(httpsPrefix.length);
  const end = rest.search(/[/?#]/);
  const authority = end === -1 ? rest : rest.slice(0, end);
  return /^[a-z0-9.-]+$/.test(authority) ? authority : null;
}

function knownPushHost(value: string): boolean {
  const host = authorityOf(value);
  if (host === null) return false;
  if (pushHosts.has(host)) return true;
  return host.endsWith(windowsSuffix) && host.length > windowsSuffix.length;
}

export const pushEndpointSchema = z
  .url()
  .max(2048)
  .refine(knownPushHost, 'not an https endpoint on a known push service');

export const pushSubscribeSchema = z.strictObject({
  endpoint: pushEndpointSchema,
  keys: z.strictObject({
    p256dh: z.string().regex(/^[A-Za-z0-9_-]{87}$/),
    auth: z.string().regex(/^[A-Za-z0-9_-]{22}$/),
  }),
  expirationTime: z.number().int().min(0).nullable(),
});
export type PushSubscribe = z.infer<typeof pushSubscribeSchema>;

export const pushUnsubscribeSchema = z.strictObject({ endpoint: pushEndpointSchema });
export type PushUnsubscribe = z.infer<typeof pushUnsubscribeSchema>;
