import type { CommandBody } from '@uw/contracts';
import { templates } from '@uw/harness';
import { commandHandler, fromKernel } from '../handler.ts';

export const activateTemplateCommand = commandHandler({
  name: 'activate_template',
  action: 'admin',
  scope: 'new_harness',
  run: async ({ kernel, caller, harnessId }, body: CommandBody<'activate_template'>) => {
    const template = templates.get(body.template);
    if (template === undefined) return { ok: false, reason: 'malformed_command' };
    const { harnessKey, jdArea, repository } = body;
    const input = { harnessId, harnessKey, jdArea, template, repository };
    return fromKernel(await kernel.stages.activate(caller, input));
  },
});

export const createStageCommand = commandHandler({
  name: 'create_stage',
  action: 'admin',
  run: async ({ kernel, caller, harnessId }, body: CommandBody<'create_stage'>) =>
    fromKernel(await kernel.stages.createStage(caller, { harnessId, stage: body.stage })),
});

export const updateStageCommand = commandHandler({
  name: 'update_stage',
  action: 'admin',
  run: async ({ kernel, caller, harnessId }, body: CommandBody<'update_stage'>) => {
    const { stageKey, change } = body;
    return fromKernel(await kernel.stages.updateStage(caller, { harnessId, stageKey, change }));
  },
});

export const reorderStagesCommand = commandHandler({
  name: 'reorder_stages',
  action: 'admin',
  run: async ({ kernel, caller, harnessId }, body: CommandBody<'reorder_stages'>) =>
    fromKernel(await kernel.stages.reorderStages(caller, { harnessId, order: body.order })),
});

export const removeStageCommand = commandHandler({
  name: 'remove_stage',
  action: 'admin',
  run: async ({ kernel, caller, harnessId }, body: CommandBody<'remove_stage'>) =>
    fromKernel(await kernel.stages.removeStage(caller, { harnessId, stageKey: body.stageKey })),
});

export const pauseCommand = commandHandler({
  name: 'pause',
  action: 'admin',
  run: async ({ kernel, caller, harnessId }, body: CommandBody<'pause'>) =>
    fromKernel(await kernel.stages.pause(caller, { harnessId, stageKey: body.stageKey })),
});

export const resumeCommand = commandHandler({
  name: 'resume',
  action: 'admin',
  run: async ({ kernel, caller, harnessId }, body: CommandBody<'resume'>) =>
    fromKernel(await kernel.stages.resume(caller, { harnessId, stageKey: body.stageKey })),
});
