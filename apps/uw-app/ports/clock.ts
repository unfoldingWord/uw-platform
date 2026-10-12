import type { Clock } from '@uw/harness';

export const systemClock: Clock = { now: () => new Date() };
