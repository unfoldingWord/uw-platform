import { z } from 'zod';

export const verbNames = [
  'search_pages',
  'read_page',
  'write_page',
  'attach_file',
  'render_pdf',
  'resolve_context',
  'query_entities',
  'create_task',
  'read_collection',
  'read_view',
  'create_row',
  'set_property',
  'list_gifts',
  'create_draft_journal_entry',
  'poll_queue',
  'claim_item',
  'submit_to_gate',
  'record_run_step',
  'get_health',
  'set_reminder',
  'cancel_reminder',
  'list_reminders',
  'read_my_calendar',
  'find_free_time',
  'hold_time',
  'release_hold',
  'propose_email',
  'propose_invite',
  'propose_page_append',
  'search_web',
  'read_web_page',
  'find_flights',
  'save_measure',
  'save_dashboard',
  'run_measure',
  'read_measure_run',
  'read_metric',
  'read_observations',
  'preview_dashboard',
] as const;

export const FORBIDDEN_VERBS = ['approve', 'merge', 'deploy', 'publish', 'advance'] as const;

export function isForbiddenVerbName(name: string): boolean {
  const normal = name.trim().toLowerCase();
  return FORBIDDEN_VERBS.some((verb) => normal.includes(verb));
}

export const verbNameSchema = z.enum(verbNames);
export const forbiddenVerbSchema = z.enum(FORBIDDEN_VERBS);

export type VerbName = z.infer<typeof verbNameSchema>;
export type ForbiddenVerb = z.infer<typeof forbiddenVerbSchema>;
