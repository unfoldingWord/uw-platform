import { notWiredCall, type Notifier } from '@uw/harness';

export const notifierNotWired: Notifier = {
  notify: () => notWiredCall('notifier', 'notify'),
};
