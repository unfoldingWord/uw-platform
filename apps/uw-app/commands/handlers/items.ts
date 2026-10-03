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

export const tweakPackageCommand = commandHandler({
  name: 'tweak_package',
  action: 'write',
  run: async (context, body) => {
    const first = [...context.stages].sort((a, b) => a.position - b.position)[0];
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
