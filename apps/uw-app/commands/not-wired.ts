import type { CommandName } from '@uw/contracts';
import type { AclAction } from '@uw/core/acl';
import { commandHandler, type CommandHandler, type CommandScope } from './handler.ts';

export function notWiredCommand(
  name: CommandName,
  action: AclAction,
  scope: CommandScope = 'harness',
): CommandHandler {
  return commandHandler({
    name,
    action,
    scope,
    run: async () => ({ ok: false, reason: 'not_wired' }),
  });
}
