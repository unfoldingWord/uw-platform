import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { Stage } from '@uw/contracts';
import type { AnyExecutor } from '../any-database.ts';
import { harnessStages } from '../schema.ts';
import { refusing } from './refusal.ts';
import { toStage } from './rows.ts';
import type { HarnessStagesGateway, StagePosition } from './types.ts';

const repositionOffset = 1_000_000;

function columnsOf(stage: Stage) {
  return {
    key: stage.key,
    title: stage.title,
    position: stage.position,
    bracket: stage.bracket,
    agentPickup: stage.agentPickup,
    exitGate: stage.exitGate,
    connector: stage.connector,
    wipLimit: stage.wipLimit,
    instructionsPageId: stage.instructionsPageId,
    validators: [...stage.validators],
    feeds: [...stage.feeds],
    paused: stage.paused,
  };
}

async function reposition(
  executor: AnyExecutor,
  harnessId: string,
  positions: readonly StagePosition[],
): Promise<void> {
  if (positions.length === 0) return;
  const listed = and(
    eq(harnessStages.harnessId, harnessId),
    inArray(
      harnessStages.id,
      positions.map((entry) => entry.id),
    ),
  );
  await executor
    .update(harnessStages)
    .set({ position: sql`${harnessStages.position} + ${repositionOffset}` })
    .where(listed);
  for (const entry of positions) {
    await executor
      .update(harnessStages)
      .set({ position: entry.position })
      .where(and(eq(harnessStages.harnessId, harnessId), eq(harnessStages.id, entry.id)));
  }
}

export function bindStages(executor: AnyExecutor): HarnessStagesGateway {
  return {
    read: {
      forHarness: async (harnessId) => {
        const rows = await executor
          .select()
          .from(harnessStages)
          .where(eq(harnessStages.harnessId, harnessId))
          .orderBy(asc(harnessStages.position));
        return rows.map(toStage);
      },
    },
    write: {
      insert: (stage) =>
        refusing(async () => {
          await executor
            .insert(harnessStages)
            .values({ id: stage.id, harnessId: stage.harnessId, ...columnsOf(stage) });
        }),
      update: (stage) =>
        refusing(async () => {
          const rows = await executor
            .update(harnessStages)
            .set(columnsOf(stage))
            .where(eq(harnessStages.id, stage.id))
            .returning({ id: harnessStages.id });
          if (rows.length === 0) throw new Error(`no stage ${stage.id} to update`);
        }),
      reposition: (harnessId, positions) =>
        refusing(() => reposition(executor, harnessId, positions)),
    },
  };
}
