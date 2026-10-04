import { formatCount } from '@uw/core/money';
import { VIEW_LIMIT } from '@uw/harness';

const limit = formatCount(VIEW_LIMIT);

export const parkedCapNote = `A harness has at least ${limit} parked items. Gates are read from the ${limit} with the highest priority on each harness.`;

export const lapsedCapNote = `At least ${limit} of your delegations lapsed in the last 7 days. The latest ${limit} are read.`;
