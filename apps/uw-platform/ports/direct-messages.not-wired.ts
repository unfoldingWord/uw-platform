import { notWiredCall, type DirectMessages } from '@uw/harness';

export const directMessagesNotWired: DirectMessages = {
  send: () => notWiredCall('directMessages', 'send'),
};
