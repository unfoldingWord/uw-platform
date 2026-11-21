import type { ExecutionContext as RequestContext } from 'hono';
import { createIngestApp } from './app.ts';
import { withSecrets, type IngestWorkerEnv } from './secrets.ts';

const app = createIngestApp();

export default {
  fetch: async (request: Request, env: IngestWorkerEnv, context: RequestContext) =>
    app.fetch(request, await withSecrets(env), context),
} satisfies ExportedHandler<IngestWorkerEnv>;
