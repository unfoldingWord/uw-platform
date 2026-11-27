import { sql } from 'drizzle-orm';
import { index, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { oneOf } from './checks.ts';

const assistantRequestEventNames = [
  'assistant_request_recorded',
  'assistant_turn_started',
  'assistant_turn_refused',
  'assistant_turn_finished',
  'assistant_effect_started',
] as const;
const assistantEffectEventNames = [
  'assistant_effect_started',
  'assistant_effect_done',
  'assistant_effect_failed',
] as const;
export const assistantFinishedEventName = 'assistant_turn_finished';
export const assistantStartedEventName = 'assistant_turn_started';

type EventColumns = {
  readonly harnessId: AnyPgColumn;
  readonly name: AnyPgColumn;
  readonly evidence: AnyPgColumn;
  readonly at: AnyPgColumn;
};

export function evidenceField(evidence: AnyPgColumn, field: 'requestId' | 'effectId' | 'turnId') {
  return sql`(${evidence} ->> ${sql.raw(`'${field}'`)})`;
}

export function assistantEventIndexes(t: EventColumns) {
  return [
    index('harness_events_assistant_request')
      .on(t.harnessId, evidenceField(t.evidence, 'requestId'))
      .where(oneOf(t.name, assistantRequestEventNames)),
    index('harness_events_assistant_effect')
      .on(t.harnessId, evidenceField(t.evidence, 'effectId'))
      .where(oneOf(t.name, assistantEffectEventNames)),
    index('harness_events_assistant_spend')
      .on(t.harnessId, t.at)
      .where(oneOf(t.name, [assistantFinishedEventName])),
    index('harness_events_assistant_open')
      .on(t.harnessId, t.at)
      .where(oneOf(t.name, [assistantStartedEventName])),
  ];
}
