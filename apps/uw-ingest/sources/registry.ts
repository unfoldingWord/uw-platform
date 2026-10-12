import type { IngestSource } from '@uw/contracts';
import type { WebhookSource } from '../env.ts';
import { githubSource } from './github.ts';
import { zulipSource } from './zulip.ts';

export const webhookSources: ReadonlyMap<IngestSource, WebhookSource> = new Map([
  ['github', githubSource],
  ['zulip', zulipSource],
]);
