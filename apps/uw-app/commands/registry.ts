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
import { importCommand } from './handlers/import.ts';
import { notWiredCommand } from './not-wired.ts';
import { revokeDelegationCommand, scheduleRegularTweakCommand } from './person/delegations.ts';
import {
  approveCommand,
  overrideCommand,
  recoverConnectorsCommand,
  rejectCommand,
  takeOverCommand,
} from './person/gates.ts';
import {
  activateTemplateCommand,
  createStageCommand,
  pauseCommand,
  removeStageCommand,
  reorderStagesCommand,
  resumeCommand,
  updateStageCommand,
} from './person/stages.ts';

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
  importCommand,
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
  pauseCommand,
  resumeCommand,
  tweakPackageCommand,
  scheduleRegularTweakCommand,
  revokeDelegationCommand,
  recoverConnectorsCommand,
  activateTemplateCommand,
  createStageCommand,
  updateStageCommand,
  reorderStagesCommand,
  removeStageCommand,
]);
