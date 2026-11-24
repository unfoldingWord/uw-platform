import { createTask } from '../../tasks/store.ts';
import type { VerbContext } from '../context.ts';
import { gatedHandler, refusal, type VerbInput } from '../handler.ts';

type CreateInput = VerbInput<'create_task'>;

async function taskArea(_context: VerbContext, input: CreateInput) {
  return { resource: { kind: 'area' as const, area: input.jdArea }, found: null };
}

export const createTaskVerb = gatedHandler({
  name: 'create_task',
  hidden: () => refusal('not_permitted'),
  resource: taskArea,
  run: async (context, input) => {
    const { db, principal, traceId, at } = context;
    const task = { ...input, taskId: crypto.randomUUID() };
    const created = await createTask(db, principal, task, traceId, at);
    if (!created.ok) {
      const page = created.reason === 'page_not_found' && input.pageId !== null;
      return refusal(created.reason, page ? { pageId: input.pageId } : {});
    }
    return { status: 'accepted', output: { taskId: created.task.taskId, status: 'suggested' } };
  },
});
