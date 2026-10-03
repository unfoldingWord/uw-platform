import { createApp } from './app.tsx';
import { runScheduled } from './cron/scheduled.ts';
import type { Bindings } from './env.ts';
import { consumeIngestBatch } from './queue/worker.ts';

export { HarnessHub } from './live/harness-hub.ts';

const app = createApp();

export default {
  fetch: app.fetch,
  queue: consumeIngestBatch,
  scheduled: runScheduled,
} satisfies ExportedHandler<Bindings>;
