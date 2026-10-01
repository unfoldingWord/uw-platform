import { z } from 'zod';

export const verbNames = [
  'search_pages',
  'read_page',
  'write_page',
  'resolve_context',
  'query_entities',
  'create_task',
  'list_gifts',
  'create_draft_journal_entry',
  'poll_queue',
  'claim_item',
  'submit_to_gate',
  'record_run_step',
  'get_health',
] as const;

export const FORBIDDEN_VERBS = ['approve', 'merge', 'deploy', 'publish', 'advance'] as const;

export const verbNameSchema = z.enum(verbNames);
export const forbiddenVerbSchema = z.enum(FORBIDDEN_VERBS);

export type VerbName = z.infer<typeof verbNameSchema>;
export type ForbiddenVerb = z.infer<typeof forbiddenVerbSchema>;
