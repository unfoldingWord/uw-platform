import { eq } from 'drizzle-orm';
import { draftStageSchema, stageSchema } from '@uw/contracts';
import type { AnyExecutor } from '../any-database.ts';
import { people, workflowDrafts } from '../schema.ts';
import { refusing } from './refusal.ts';
import type { WorkflowDraftsGateway } from './types.ts';

const draftStages = draftStageSchema.array();
const baseStages = stageSchema.array();

export function bindDrafts(executor: AnyExecutor): WorkflowDraftsGateway {
  return {
    read: {
      forHarness: async (harnessId) => {
        const [row] = await executor
          .select({ draft: workflowDrafts, holderName: people.displayName })
          .from(workflowDrafts)
          .innerJoin(people, eq(people.id, workflowDrafts.holderPersonId))
          .where(eq(workflowDrafts.harnessId, harnessId))
          .limit(1);
        if (row === undefined) return null;
        const { draft, holderName } = row;
        return {
          ...draft,
          stages: draftStages.parse(draft.stages),
          base: baseStages.parse(draft.base),
          holderName,
        };
      },
    },
    write: {
      put: (draft) =>
        refusing(async () => {
          const values = { ...draft, stages: [...draft.stages], base: [...draft.base] };
          await executor
            .insert(workflowDrafts)
            .values(values)
            .onConflictDoUpdate({ target: workflowDrafts.harnessId, set: values });
        }),
      remove: (harnessId) =>
        refusing(async () => {
          const rows = await executor
            .delete(workflowDrafts)
            .where(eq(workflowDrafts.harnessId, harnessId))
            .returning({ harnessId: workflowDrafts.harnessId });
          return rows.length > 0;
        }),
    },
  };
}
