import { z } from 'zod';

export const platformCommandNameSchema = z.enum([
  'grant_role',
  'revoke_role',
  'create_page',
  'update_page',
  'confirm_page',
  'bind_service_token',
  'revoke_service_token',
]);

export type PlatformCommandName = z.infer<typeof platformCommandNameSchema>;
