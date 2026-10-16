import { and, asc, eq, gte, isNotNull } from 'drizzle-orm';
import type { AnyExecutor } from '../any-database.ts';
import { gateDecisions } from '../schema.ts';
import { checkedRows } from './limits.ts';
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
      anyForStage: async (stageId) => {
        const rows = await executor
          .select({ id: gateDecisions.id })
          .from(gateDecisions)
          .where(eq(gateDecisions.stageId, stageId))
          .limit(1);
        return rows.length > 0;
      },
      delegatedSince: async (since, limit) => {
        const rows = await executor
          .select()
          .from(gateDecisions)
          .where(and(isNotNull(gateDecisions.delegationId), gte(gateDecisions.decidedAt, since)))
          .orderBy(asc(gateDecisions.decidedAt), asc(gateDecisions.id))
          .limit(checkedRows(limit, 'delegated decision'));
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
