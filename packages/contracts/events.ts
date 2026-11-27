import { z } from 'zod';
import { eventEvidenceSchemas } from './event-evidence.ts';
import { identitySchema } from './identity.ts';

export const eventNames = [
  'item_created',
  'item_claimed',
  'item_released',
  'item_reordered',
  'lease_renewed',
  'lease_expired',
  'branch_abandoned',
  'branch_adopted',
  'stage_advanced',
  'loop_edge_taken',
  'premise_held',
  'risk_derived',
  'label_removed',
  'run_started',
  'run_step_recorded',
  'run_failed',
  'run_hibernated',
  'run_resumed',
  'run_stopped',
  'run_completed',
  'run_prompted',
  'submitted_to_gate',
  'checks_passed',
  'checks_failed',
  'gate_approved',
  'gate_rejected',
  'gate_taken_over',
  'gate_overridden',
  'gate_refused_to_agent',
  'ship_refused',
  'connector_succeeded',
  'connector_refused',
  'delegation_granted',
  'delegation_revoked',
  'delegation_lapsed',
  'delegation_required',
  'stage_edit_refused',
  'stage_edited',
  'stage_removed',
  'workflow_draft_opened',
  'workflow_draft_saved',
  'workflow_draft_taken_over',
  'workflow_draft_discarded',
  'workflow_published',
  'template_activated',
  'harness_paused',
  'harness_resumed',
  'hosted_builder_set',
  'learning_attached',
  'nothing_learned',
  'comment_recorded',
  'zulip_topic_linked',
  'breaker_holding',
  'breaker_pausing',
  'breaker_open',
  'persona_activation_failed',
  'persona_activated',
  'measurement_recorded',
  'handed_to_person',
  'review_verdict_recorded',
  'shadow_verdict',
  'shadow_lifted',
  'shadow_turned_on',
  'freeze_changed',
  'finding_refuted',
  'delegated_merge',
  'delegated_exit_claimed',
  'fix_claimed',
  'fix_claim_set',
  'title_set',
  'epic_enqueued',
  'done_when_missing',
  'silence_alarm',
  'template_changed',
  'assistant_customised',
  'assistant_request_recorded',
  'assistant_turn_started',
  'assistant_turn_refused',
  'assistant_turn_finished',
  'assistant_effect_started',
  'assistant_effect_done',
  'assistant_effect_failed',
  'assistant_reminder_set',
  'assistant_reminder_cancelled',
  'assistant_reminder_fired',
  'assistant_reminder_undelivered',
  'assistant_pairing_started',
  'assistant_paired',
  'assistant_pairing_refused',
  'assistant_budget_set',
  'assistant_hold_placed',
  'assistant_hold_released',
  'assistant_enabled',
  'assistant_disabled',
  'assistant_provisioned',
  'assistant_provisioning_failed',
  'assistant_deleted',
  'assistant_effect_undone',
  'assistant_history_redacted',
  'assistant_mail_declined',
] as const;

export const eventNameSchema = z.enum(eventNames);

const evidenceByName: ReadonlyMap<string, z.ZodType> = new Map(
  Object.entries(eventEvidenceSchemas),
);

function checkEvidence(
  event: { readonly name: string; readonly evidence: unknown },
  context: z.RefinementCtx,
): void {
  const schema = evidenceByName.get(event.name);
  if (!schema) return;
  const result = schema.safeParse(event.evidence);
  if (result.success) return;
  context.addIssue({
    code: 'custom',
    path: ['evidence'],
    message: `evidence does not fit ${event.name}: ${result.error.issues.map((issue) => issue.message).join('; ')}`,
  });
}

const fields = {
  eventId: z.uuid(),
  harnessId: z.uuid(),
  itemId: z.uuid().nullable(),
  name: eventNameSchema,
  at: z.iso.datetime(),
  actor: identitySchema,
  evidence: z.record(z.string(), z.json()),
  traceId: z.uuid(),
  requestId: z.uuid().nullable().default(null),
};

export const newEventSchema = z.strictObject(fields).superRefine(checkEvidence);
export const eventSchema = z
  .strictObject({ ...fields, position: z.number().int().min(1) })
  .superRefine(checkEvidence);

export type EventName = z.infer<typeof eventNameSchema>;
export type NewHarnessEvent = z.infer<typeof newEventSchema>;
export type HarnessEvent = z.infer<typeof eventSchema>;
