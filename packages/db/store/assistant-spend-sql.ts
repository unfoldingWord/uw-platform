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

export function turnStartedSince(harnessId: unknown, since: Date) {
  return sql`EXISTS (
    SELECT 1 FROM ${harnessEvents}
    WHERE ${harnessEvents.harnessId} = ${harnessId}
      AND ${harnessEvents.name} = 'assistant_turn_started'
      AND ${harnessEvents.at} >= ${since.toISOString()}::timestamptz)`;
}

export function effectSettledSql(effectId: unknown, harnessId: unknown) {
  return sql`EXISTS (
    SELECT 1 FROM ${harnessEvents}
    WHERE ${harnessEvents.harnessId} = ${harnessId}
      AND ${harnessEvents.name} IN ('assistant_effect_done', 'assistant_effect_failed')
      AND ${evidenceField(harnessEvents.evidence, 'effectId')} = (${effectId})::text)`;
}
