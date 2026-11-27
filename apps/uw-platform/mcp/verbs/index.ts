import type { VerbHandler } from '../handler.ts';
import {
  findFreeTimeVerb,
  holdTimeVerb,
  readMyCalendarVerb,
  releaseHoldVerb,
} from './assistant-calendar.ts';
import { cancelReminderVerb, listRemindersVerb, setReminderVerb } from './assistant-reminders.ts';
import { attachFileVerb } from './attach-file.ts';
import { claimItem } from './claim-item.ts';
import { createRowVerb, readCollectionVerb, readViewVerb, setPropertyVerb } from './collections.ts';
import { createTaskVerb } from './create-task.ts';
import { getHealth } from './get-health.ts';
import { pollQueue } from './poll-queue.ts';
import { queryEntities } from './query-entities.ts';
import { readPageVerb } from './read-page.ts';
import { recordRunStep } from './record-run-step.ts';
import { renderPdfVerb } from './render-pdf.ts';
import { resolveContext } from './resolve-context.ts';
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
  setReminderVerb,
  cancelReminderVerb,
  listRemindersVerb,
  readMyCalendarVerb,
  findFreeTimeVerb,
  holdTimeVerb,
  releaseHoldVerb,
];

export const verbHandlers: ReadonlyMap<string, VerbHandler> = new Map(
  handlers.map((handler) => [handler.name, handler]),
);
