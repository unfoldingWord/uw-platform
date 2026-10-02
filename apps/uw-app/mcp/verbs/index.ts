import type { VerbHandler } from '../handler.ts';
import { claimItem } from './claim-item.ts';
import { getHealth } from './get-health.ts';
import { pollQueue } from './poll-queue.ts';
import { recordRunStep } from './record-run-step.ts';
import { submitToGate } from './submit-to-gate.ts';

const handlers: readonly VerbHandler[] = [
  pollQueue,
  claimItem,
  submitToGate,
  recordRunStep,
  getHealth,
];

export const verbHandlers: ReadonlyMap<string, VerbHandler> = new Map(
  handlers.map((handler) => [handler.name, handler]),
);
