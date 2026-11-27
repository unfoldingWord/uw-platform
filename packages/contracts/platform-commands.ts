import { z } from 'zod';

export const platformCommandNameSchema = z.enum([
  'grant_role',
  'revoke_role',
  'create_page',
  'update_page',
  'confirm_page',
  'bind_service_token',
  'revoke_service_token',
  'pause_routine',
  'resume_routine',
  'revoke_routine',
  'approve_person',
  'decline_person',
  'save_profile_body',
  'create_credential',
  'rotate_credential',
  'revoke_credential',
  'bind_credential',
  'unbind_credential',
  'grant_reveal',
  'confirm_reveal',
  'revoke_reveal',
  'reveal_credential',
  'set_assistant_budget',
  'enable_assistant',
  'disable_assistant',
  'grant_assist',
]);

export type PlatformCommandName = z.infer<typeof platformCommandNameSchema>;
