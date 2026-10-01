import { verify } from '@octokit/webhooks-methods';
import type { IngestRefusal } from '@uw/contracts';
import type { VerifiedDelivery, WebhookSource } from '../env.ts';

async function signatureMatches(secret: string, rawBody: string, signature: string) {
  try {
    return await verify(secret, rawBody, signature);
  } catch {
    return false;
  }
}

async function verifyGithub(
  headers: Headers,
  rawBody: string,
  secret: string,
): Promise<VerifiedDelivery | IngestRefusal> {
  const signature = headers.get('x-hub-signature-256');
  if (!signature) return 'unsigned';
  if (!(await signatureMatches(secret, rawBody, signature))) return 'bad_signature';
  const deliveryId = headers.get('x-github-delivery');
  const event = headers.get('x-github-event');
  if (!deliveryId || !event) return 'malformed_delivery';
  return { deliveryId, event };
}

export const githubSource: WebhookSource = {
  secret: (env) => env.GITHUB_WEBHOOK_SECRET,
  verify: verifyGithub,
};
