import type { Stage } from '@uw/contracts';
import { readPage } from '../../pages/store.ts';
import { commandHandler, fromKernel, type CommandContext } from '../handler.ts';

function at(context: CommandContext): Date {
  return context.clock.now();
}

export const enqueueCommand = commandHandler({
  name: 'enqueue',
  action: 'write',
  run: async (context, body) =>
    fromKernel(
      await context.kernel.items.enqueue(context.caller, {
        harnessId: context.harnessId,
        title: body.title,
        pageId: body.pageId,
        priority: 0,
        due: body.due,
        delegationId: null,
      }),
    ),
});

export const claimCommand = commandHandler({
  name: 'claim',
  action: 'write',
  run: async (context, body) =>
    fromKernel(
      await context.kernel.items.claim(context.caller, { itemId: body.itemId, delegationId: null }),
    ),
});

export const releaseCommand = commandHandler({
  name: 'release',
  action: 'write',
  run: async (context, body) =>
    fromKernel(
      await context.kernel.items.release(context.caller, {
        itemId: body.itemId,
        delegationId: null,
      }),
    ),
});

export const kickstartCommand = commandHandler({
  name: 'kickstart',
  action: 'write',
  run: async (context, body) => {
    const page = await readPage(
      context.database.db,
      context.caller.actor,
      body.pageId,
      at(context),
    );
    if (page === null) return { ok: false, reason: 'page_not_found' };
    if (page.type !== 'product' || page.jdArea !== context.harness?.jdArea) {
      return { ok: false, reason: 'malformed_command' };
    }
    return fromKernel(
      await context.kernel.items.enqueue(context.caller, {
        harnessId: context.harnessId,
        title: page.title.slice(0, 200),
        pageId: page.id,
        priority: 0,
        due: null,
        delegationId: null,
      }),
    );
  },
});

export const submitCommand = commandHandler({
  name: 'submit_to_gate',
  action: 'write',
  run: async (context, body) => {
    const { pullRequest, head } = body;
    const change = pullRequest !== null && head !== null ? { pullRequest, head } : null;
    return fromKernel(
      await context.kernel.items.submit(context.caller, {
        itemId: body.itemId,
        to: body.to,
        evidence: {},
        change,
      }),
    );
  },
});

export const reorderCommand = commandHandler({
  name: 'reorder',
  action: 'write',
  run: async (context, body) =>
    fromKernel(
      await context.kernel.items.reorder(context.caller, {
        itemId: body.itemId,
        beforeItemId: body.beforeItemId,
      }),
    ),
});

async function ownStages(
  context: CommandContext,
  itemId: string,
): Promise<readonly Stage[] | null> {
  const options = { at: at(context) };
  const item = await context.kernel.reads.item(context.caller, { itemId }, options);
  if (item.status !== 'accepted' || item.value.harness.id !== context.harnessId) return null;
  const scene = await context.kernel.reads.harness(
    context.caller,
    { harnessId: item.value.harness.id },
    options,
  );
  return scene.status === 'accepted' ? scene.value.stages : null;
}

export const tweakPackageCommand = commandHandler({
  name: 'tweak_package',
  action: 'write',
  run: async (context, body) => {
    const stages = await ownStages(context, body.itemId);
    if (stages === null) return { ok: false, reason: 'item_not_found' };
    const first = [...stages].sort((a, b) => a.position - b.position)[0];
    if (first === undefined) return { ok: false, reason: 'stage_not_found' };
    return fromKernel(
      await context.kernel.items.submit(context.caller, {
        itemId: body.itemId,
        to: first.key,
        evidence: {},
        change: null,
      }),
    );
  },
});
