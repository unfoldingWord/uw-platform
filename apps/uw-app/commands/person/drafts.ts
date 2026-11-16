import type { CommandBody } from '@uw/contracts';
import { commandHandler, fromKernel } from '../handler.ts';

export const openDraftCommand = commandHandler({
  name: 'open_workflow_draft',
  action: 'admin',
  run: async ({ kernel, caller, harnessId }) =>
    fromKernel(await kernel.drafts.open(caller, { harnessId })),
});

export const saveDraftCommand = commandHandler({
  name: 'save_workflow_draft',
  action: 'admin',
  run: async ({ kernel, caller, harnessId }, body: CommandBody<'save_workflow_draft'>) =>
    fromKernel(
      await kernel.drafts.save(caller, { harnessId, revision: body.revision, stages: body.stages }),
    ),
});

export const takeOverDraftCommand = commandHandler({
  name: 'take_over_workflow_draft',
  action: 'admin',
  run: async ({ kernel, caller, harnessId }, body: CommandBody<'take_over_workflow_draft'>) =>
    fromKernel(await kernel.drafts.takeOver(caller, { harnessId, reason: body.reason })),
});

export const discardDraftCommand = commandHandler({
  name: 'discard_workflow_draft',
  action: 'admin',
  run: async ({ kernel, caller, harnessId }) =>
    fromKernel(await kernel.drafts.discard(caller, { harnessId })),
});

export const publishDraftCommand = commandHandler({
  name: 'publish_workflow_draft',
  action: 'admin',
  run: async ({ kernel, caller, harnessId }, body: CommandBody<'publish_workflow_draft'>) =>
    fromKernel(await kernel.drafts.publish(caller, { harnessId, revision: body.revision })),
});
