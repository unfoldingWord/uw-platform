import { z } from 'zod';

export const platformCommandNameSchema = z.enum([
  'grant_role',
  'revoke_role',
  'create_page',
  'update_page',
]);

export type PlatformCommandName = z.infer<typeof platformCommandNameSchema>;
