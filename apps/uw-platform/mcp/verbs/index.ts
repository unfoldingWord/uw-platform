import type { VerbHandler } from '../handler.ts';
import { attachFileVerb } from './attach-file.ts';
import { claimItem } from './claim-item.ts';
import { createRowVerb, readCollectionVerb, readViewVerb, setPropertyVerb } from './collections.ts';
import { createTaskVerb } from './create-task.ts';
import { getHealth } from './get-health.ts';
import { pollQueue } from './poll-queue.ts';
import { queryEntities } from './query-entities.ts';
import { previewDashboardVerb } from './preview-dashboard.ts';
import { readMeasureRunVerb } from './read-measure-run.ts';
import { readMetricVerb } from './read-metric.ts';
import { readObservationsVerb } from './read-observations.ts';
import { readPageVerb } from './read-page.ts';
import { recordRunStep } from './record-run-step.ts';
import { renderChartVerb } from './render-chart.ts';
import { renderPdfVerb } from './render-pdf.ts';
import { resolveContext } from './resolve-context.ts';
import { runMeasureVerb } from './run-measure.ts';
import { saveDashboardVerb } from './save-dashboard.ts';
import { saveMeasureVerb } from './save-measure.ts';
import { searchPagesVerb } from './search-pages.ts';
import { submitToGate } from './submit-to-gate.ts';
import { writePageVerb } from './write-page.ts';

const handlers: readonly VerbHandler[] = [
  pollQueue,
  claimItem,
  submitToGate,
  recordRunStep,
  getHealth,
  searchPagesVerb,
  readPageVerb,
  writePageVerb,
  attachFileVerb,
  renderPdfVerb,
  resolveContext,
  queryEntities,
  createTaskVerb,
  readCollectionVerb,
  readViewVerb,
  createRowVerb,
  setPropertyVerb,
  saveMeasureVerb,
  saveDashboardVerb,
  runMeasureVerb,
  readMeasureRunVerb,
  readMetricVerb,
  readObservationsVerb,
  previewDashboardVerb,
  renderChartVerb,
];

export const verbHandlers: ReadonlyMap<string, VerbHandler> = new Map(
  handlers.map((handler) => [handler.name, handler]),
);
