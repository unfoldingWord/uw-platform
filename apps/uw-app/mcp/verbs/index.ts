import type { VerbHandler } from '../handler.ts';
import { claimItem } from './claim-item.ts';
import { getHealth } from './get-health.ts';
import { pollQueue } from './poll-queue.ts';
import { readPageVerb } from './read-page.ts';
import { recordRunStep } from './record-run-step.ts';
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
];

export const verbHandlers: ReadonlyMap<string, VerbHandler> = new Map(
  handlers.map((handler) => [handler.name, handler]),
);
