import { notWiredCall, type Workspace } from '@uw/harness';

export const workspaceNotWired: Workspace = {
  listEvents: () => notWiredCall('workspace', 'listEvents'),
  freeBusy: () => notWiredCall('workspace', 'freeBusy'),
  placeHold: () => notWiredCall('workspace', 'placeHold'),
  removeHold: () => notWiredCall('workspace', 'removeHold'),
  sendMail: () => notWiredCall('workspace', 'sendMail'),
  sendInvite: () => notWiredCall('workspace', 'sendInvite'),
};
