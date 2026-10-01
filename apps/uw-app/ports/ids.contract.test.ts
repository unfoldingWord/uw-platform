import { describeIdsContract } from '@uw/harness/port-contracts/ids';
import { randomIds } from './ids.ts';

describeIdsContract('crypto.randomUUID', () => randomIds);
