import type { ExecutionContext as RequestContext } from 'hono';
import { createApp } from './app.tsx';
import { runScheduled } from './cron/scheduled.ts';
import { consumeIngestBatch } from './queue/worker.ts';
import { withSecrets, type WorkerEnv } from './secrets.ts';

export { ClaudeCodeSandbox, CodexSandbox, ContainerProxy } from './engines/sandbox/classes.ts';
export { HarnessHub } from './live/harness-hub.ts';
export { PageDraft } from './pages/draft-hub.ts';
export { AssistantTurn } from './assistants/turn/workflow.ts';
export { PdfExportRun } from './pdf/workflow.ts';
export { HarnessRun } from './runs/workflow.ts';

const app = createApp();

export default {
  fetch: async (request: Request, env: WorkerEnv, context: RequestContext) =>
    app.fetch(request, await withSecrets(env), context),
  queue: consumeIngestBatch,
  scheduled: runScheduled,
} satisfies ExportedHandler<WorkerEnv>;
