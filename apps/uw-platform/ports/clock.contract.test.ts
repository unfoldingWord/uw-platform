import { describeClockContract } from '@uw/harness/port-contracts/clock';
import { systemClock } from './clock.ts';

describeClockContract('the system clock', () => systemClock);
