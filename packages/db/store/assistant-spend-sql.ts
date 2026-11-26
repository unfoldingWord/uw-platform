import { sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { assistantFinishedEventName, evidenceField } from '../assistant-event-indexes.ts';
import { harnessEvents } from '../schema.ts';

export const costMicros = sql`${harnessEvents.evidence} -> 'costMicros'`;
const finishedTurn = alias(harnessEvents, 'finished_turn');
export const knownCost = sql`jsonb_typeof(${costMicros}) = 'number'`;
export const sameTurnFinished = sql`EXISTS (
  SELECT 1 FROM ${harnessEvents} AS ${finishedTurn}
  WHERE ${finishedTurn.harnessId} = ${harnessEvents.harnessId}
    AND ${finishedTurn.name} = ${assistantFinishedEventName}
    AND ${evidenceField(finishedTurn.evidence, 'requestId')} = ${evidenceField(harnessEvents.evidence, 'requestId')}
    AND ${evidenceField(finishedTurn.evidence, 'turnId')} = ${evidenceField(harnessEvents.evidence, 'turnId')})`;
