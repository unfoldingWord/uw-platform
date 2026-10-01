import type { Ids } from '@uw/harness';

export const randomIds: Ids = { next: () => crypto.randomUUID() };
