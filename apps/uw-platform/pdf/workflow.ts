import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import { z } from 'zod';
import { hyperdriveDatabase, type DatabaseHandle } from '../database.ts';
import { commitOf, type Bindings, type PdfExportStart } from '../env.ts';
import { bucketFiles } from '../pages/file-store.ts';
import { systemClock } from '../ports/clock.ts';
import { withSecrets } from '../secrets.ts';
import { abandonPdfExport, runPdfExport, type PdfExportDeps } from './export-run.ts';
import { pdfRendererOf } from './renderer.ts';

const startSchema = z.object({ exportId: z.uuid(), traceId: z.uuid() });

const RENDER = {
  retries: { limit: 2, delay: '10 seconds', backoff: 'exponential' },
  timeout: '5 minutes',
} as const;

function depsOf(env: Bindings, database: DatabaseHandle): PdfExportDeps | null {
  if (env.FILES === undefined) return null;
  return {
    db: database.db,
    files: bucketFiles(env.FILES),
    renderer: pdfRendererOf(env),
    origin: env.APP_ORIGIN ?? '',
    commit: commitOf(env),
    now: () => systemClock.now(),
  };
}

async function rendered(
  step: WorkflowStep,
  deps: PdfExportDeps,
  start: PdfExportStart,
): Promise<string> {
  try {
    return await step.do('render', RENDER, () => runPdfExport(deps, start));
  } catch {
    return step.do('abandon', () => abandonPdfExport(deps, start, 'internal_error'));
  }
}

export class PdfExportRun extends WorkflowEntrypoint<Bindings, PdfExportStart> {
  override async run(
    event: Readonly<WorkflowEvent<PdfExportStart>>,
    step: WorkflowStep,
  ): Promise<string> {
    const start = startSchema.parse(event.payload);
    const env = await withSecrets(this.env);
    const database = hyperdriveDatabase(env);
    if (database === null) return 'database_not_configured';
    try {
      const deps = depsOf(env, database);
      if (deps !== null) return await rendered(step, deps, start);
      const unwired = { db: database.db, now: () => systemClock.now() };
      return await step.do('unwired', () => abandonPdfExport(unwired, start, 'not_wired'));
    } finally {
      await database.release();
    }
  }
}
