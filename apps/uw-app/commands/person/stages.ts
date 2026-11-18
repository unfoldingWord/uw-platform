import type { CommandBody } from '@uw/contracts';
import { templates } from '@uw/harness';
import { commandHandler, fromKernel } from '../handler.ts';

export const activateTemplateCommand = commandHandler({
  name: 'activate_template',
  action: 'admin',
  scope: 'new_harness',
  run: async ({ kernel, caller, harnessId, pages }, body: CommandBody<'activate_template'>) => {
    const template = templates.get(body.template);
    if (template === undefined) return { ok: false, reason: 'malformed_command' };
    const { harnessKey, jdArea, repository, shadow, externalReviewerIdentities, botAuthors } = body;
    const input = {
      harnessId,
      harnessKey,
      jdArea,
      template,
      repository,
      shadow,
      externalReviewerIdentities,
      botAuthors,
      requiredChecks: body.requiredChecks,
      protectedPaths: body.protectedPaths,
      ...(body.title === undefined ? {} : { title: body.title }),
    };
    const activated = await kernel.stages.activate(caller, input);
    if (activated.status === 'accepted') {
      await pages.draftPersonas(body.template, activated.value.harness);
    }
    return fromKernel(activated);
  },
});

export const changeTemplateCommand = commandHandler({
  name: 'change_template',
  action: 'admin',
  run: async ({ kernel, caller, harnessId, pages }, body: CommandBody<'change_template'>) => {
    const changed = await kernel.stages.changeTemplate(caller, {
      harnessId,
      template: body.template,
    });
    if (changed.status === 'accepted') {
      await pages.draftPersonas(body.template, changed.value.harness);
    }
    return fromKernel(changed);
  },
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

export const setHostedBuilderCommand = commandHandler({
  name: 'set_hosted_builder',
  action: 'admin',
  run: async ({ kernel, caller, harnessId }, body: CommandBody<'set_hosted_builder'>) =>
    fromKernel(await kernel.stages.setHostedBuilder(caller, { harnessId, enabled: body.enabled })),
});

export const setFixClaimCommand = commandHandler({
  name: 'set_fix_claim',
  action: 'admin',
  run: async ({ kernel, caller, harnessId }, body: CommandBody<'set_fix_claim'>) =>
    fromKernel(await kernel.stages.setFixClaim(caller, { harnessId, enabled: body.enabled })),
});

export const setTitleCommand = commandHandler({
  name: 'set_title',
  action: 'admin',
  run: async ({ kernel, caller, harnessId }, body: CommandBody<'set_title'>) =>
    fromKernel(await kernel.stages.setTitle(caller, { harnessId, title: body.title })),
});

export const setFreezeCommand = commandHandler({
  name: 'set_freeze',
  action: 'admin',
  run: async ({ kernel, caller, harnessId }, body: CommandBody<'set_freeze'>) =>
    fromKernel(
      await kernel.stages.setFreeze(caller, { harnessId, frozen: body.frozen, allow: body.allow }),
    ),
});

export const setShadowCommand = commandHandler({
  name: 'set_shadow',
  action: 'admin',
  run: async ({ kernel, caller, harnessId }, body: CommandBody<'set_shadow'>) =>
    fromKernel(await kernel.stages.setShadow(caller, { harnessId, shadow: body.shadow })),
});

export const setStageRulesCommand = commandHandler({
  name: 'set_stage_rules',
  action: 'admin',
  run: async ({ kernel, caller, harnessId }, body: CommandBody<'set_stage_rules'>) =>
    fromKernel(await kernel.stages.setStageRules(caller, { harnessId, stages: body.stages })),
});

export const addStageInstructionsCommand = commandHandler({
  name: 'add_stage_instructions',
  action: 'admin',
  run: async (context, body: CommandBody<'add_stage_instructions'>) => {
    const { kernel, caller, harnessId, harness } = context;
    const stage = context.stages.find((entry) => entry.id === body.stageId);
    if (harness === null || stage === undefined) return { ok: false, reason: 'stage_not_found' };
    const created = await context.pages.createInstructions(harness, body.title.trim());
    if (!created.ok) return created;
    const rules = {
      id: stage.id,
      agentPickup: stage.agentPickup,
      exitGate: stage.exitGate,
      wipLimit: stage.wipLimit,
      instructionsPageId: created.pageId,
      validators: [...stage.validators],
    };
    return fromKernel(await kernel.stages.setStageRules(caller, { harnessId, stages: [rules] }));
  },
});
