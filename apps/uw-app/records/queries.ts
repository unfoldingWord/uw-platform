import { z } from 'zod';
import { jdAreaSchema, stageKeySchema } from '@uw/contracts';
import type { AclResource } from '@uw/core/acl';
import { callerOf, type VerbContext } from '../mcp/context.ts';
import { refusal, type VerbRefusal } from '../mcp/handler.ts';
import { harnessAreas } from '../mcp/verbs/item-scene.ts';
import { openTasks } from '../tasks/store.ts';

const STAGE_ITEM_LIMIT = 50;

const rowSchema = z.record(z.string(), z.json());

type Row = z.infer<typeof rowSchema>;
type QueryRow = { readonly row: Row; readonly resource: AclResource | null };
type Rows = readonly QueryRow[] | VerbRefusal;

type EntityQuery = {
  readonly params: z.ZodType;
  run(context: VerbContext, params: unknown): Promise<Rows>;
};

function entityQuery<S extends z.ZodType>(
  params: S,
  run: (context: VerbContext, params: z.infer<S>) => Promise<Rows>,
): EntityQuery {
  return { params, run: (context, raw) => run(context, params.parse(raw)) };
}

const openTasksQuery = entityQuery(z.object({ jdArea: jdAreaSchema }), async (context, params) => {
  const found = await openTasks(context.db, context.principal, params.jdArea, context.at);
  return found.map((task) => ({
    row: rowSchema.parse({
      taskId: task.taskId,
      title: task.title,
      pageId: task.pageId,
      due: task.due,
      status: task.status,
      jdArea: task.jdArea,
    }),
    resource: { kind: 'area', area: task.jdArea },
  }));
});

const stageItemsQuery = entityQuery(
  z.object({ harnessId: z.uuid(), stageKey: stageKeySchema }),
  async (context, params) => {
    const items = await context.kernel.reads.inStage(callerOf(context), params);
    if (items.status === 'error') return refusal(items.reason, items.detail);
    const areaOf = await harnessAreas(context, [params.harnessId]);
    return items.value.slice(0, STAGE_ITEM_LIMIT).map((item) => ({
      row: rowSchema.parse(item),
      resource: areaOf(item.harnessId),
    }));
  },
);

export const entityQueries: ReadonlyMap<string, EntityQuery> = new Map([
  ['open_tasks', openTasksQuery],
  ['stage_items', stageItemsQuery],
]);
