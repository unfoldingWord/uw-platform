import type { IngestSource } from '@uw/contracts';
import type { WebhookSource } from '../env.ts';
import { githubSource } from './github.ts';
import { zulipSource } from './zulip.ts';
import { zulipAssistantSource } from './zulip-assistant.ts';

export const webhookSources: ReadonlyMap<IngestSource, WebhookSource> = new Map<
  IngestSource,
  WebhookSource
>([
  ['github', githubSource],
  ['zulip', zulipSource],
  ['zulip-assistant', zulipAssistantSource],
]);
