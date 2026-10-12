import { describeIdsContract } from '@uw/harness/port-contracts/ids';
import { createSimIds } from './ids.ts';

describeIdsContract('the sequential sim ids', () => createSimIds());
