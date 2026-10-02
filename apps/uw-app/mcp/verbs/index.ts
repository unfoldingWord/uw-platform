import type { VerbHandler } from '../handler.ts';
import { getHealth } from './get-health.ts';

const handlers: readonly VerbHandler[] = [getHealth];

export const verbHandlers: ReadonlyMap<string, VerbHandler> = new Map(
  handlers.map((handler) => [handler.name, handler]),
);
