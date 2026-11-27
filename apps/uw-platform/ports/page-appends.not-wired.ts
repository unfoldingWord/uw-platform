import { notWiredCall, type PageAppends } from '@uw/harness';

export const pageAppendsNotWired: PageAppends = {
  append: () => notWiredCall('pageAppends', 'append'),
};
