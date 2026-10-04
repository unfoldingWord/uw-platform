import type { CommandBody } from '@uw/contracts';
import { commandHandler, fromKernel } from '../handler.ts';

export const activatePersonaCommand = commandHandler({
  name: 'activate_persona',
  action: 'admin',
  run: async ({ kernel, caller, harnessId }, body: CommandBody<'activate_persona'>) => {
    const input = { pageId: body.pageId, expectedVersion: body.expectedVersion, harnessId };
    return fromKernel(await kernel.personas.activate(caller, input));
  },
});
