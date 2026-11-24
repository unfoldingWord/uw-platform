import type { CommandBody } from '@uw/contracts';
import { commandHandler, fromKernel } from '../handler.ts';

export const stopRunCommand = commandHandler({
  name: 'stop_run',
  action: 'write',
  run: async ({ kernel, caller }, body: CommandBody<'stop_run'>) =>
    fromKernel(await kernel.runs.stop(caller, { itemId: body.itemId })),
});

export const promptRunCommand = commandHandler({
  name: 'prompt_run',
  action: 'write',
  run: async ({ kernel, caller }, body: CommandBody<'prompt_run'>) =>
    fromKernel(await kernel.runs.prompt(caller, { itemId: body.itemId, message: body.message })),
});
