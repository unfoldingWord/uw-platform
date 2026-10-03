import type { CommandName } from '@uw/contracts';
import { isBuiltCommand, type CommandHandler } from './handler.ts';
import {
  claimCommand,
  enqueueCommand,
  kickstartCommand,
  releaseCommand,
  reorderCommand,
  submitCommand,
  tweakPackageCommand,
} from './handlers/items.ts';
import { notWiredCommand } from './not-wired.ts';
import {
  approveCommand,
  overrideCommand,
  recoverConnectorsCommand,
  rejectCommand,
  takeOverCommand,
} from './person/gates.ts';

export function commandRegistryOf(
  handlers: readonly CommandHandler[],
): ReadonlyMap<CommandName, CommandHandler> {
  const registry = new Map<CommandName, CommandHandler>();
  for (const handler of handlers) {
    if (!isBuiltCommand(handler)) {
      throw new TypeError(`the ${handler.name} command handler was not built by commandHandler`);
    }
    if (registry.has(handler.name)) {
      throw new TypeError(`the ${handler.name} command has two handlers`);
    }
    registry.set(handler.name, handler);
  }
  return registry;
}

export const commandRegistry = commandRegistryOf([
  kickstartCommand,
  enqueueCommand,
  notWiredCommand('import', 'write'),
  reorderCommand,
  claimCommand,
  releaseCommand,
  submitCommand,
  approveCommand,
  rejectCommand,
  takeOverCommand,
  overrideCommand,
  notWiredCommand('prompt_run', 'write'),
  notWiredCommand('stop_run', 'write'),
  notWiredCommand('pause', 'admin'),
  notWiredCommand('resume', 'admin'),
  tweakPackageCommand,
  notWiredCommand('schedule_regular_tweak', 'admin'),
  notWiredCommand('revoke_delegation', 'admin'),
  recoverConnectorsCommand,
  notWiredCommand('activate_template', 'admin', 'new_harness'),
  notWiredCommand('create_stage', 'admin'),
  notWiredCommand('update_stage', 'admin'),
  notWiredCommand('reorder_stages', 'admin'),
  notWiredCommand('remove_stage', 'admin'),
]);
