import { asc, eq } from 'drizzle-orm';
import type { AnyExecutor } from '../any-database.ts';
import { gateDecisions } from '../schema.ts';
import { refusing } from './refusal.ts';
import { toGateDecision } from './rows.ts';
import type { GateDecisionsGateway } from './types.ts';

export function bindGateDecisions(executor: AnyExecutor): GateDecisionsGateway {
  return {
    read: {
      forItem: async (itemId) => {
        const rows = await executor
          .select()
          .from(gateDecisions)
          .where(eq(gateDecisions.itemId, itemId))
          .orderBy(asc(gateDecisions.decidedAt), asc(gateDecisions.id));
        return rows.map(toGateDecision);
      },
    },
    write: {
      insert: (decision) =>
        refusing(async () => {
          await executor.insert(gateDecisions).values(decision);
        }),
    },
  };
}
