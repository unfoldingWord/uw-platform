import { describeClockContract } from '@uw/harness/port-contracts/clock';
import { createSimClock } from './clock.ts';

describeClockContract('the sim clock', () => createSimClock(new Date('2026-10-01T09:00:00.000Z')));
