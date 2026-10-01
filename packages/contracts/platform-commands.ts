import { z } from 'zod';

export const platformCommandNameSchema = z.enum(['grant_role', 'revoke_role']);

export type PlatformCommandName = z.infer<typeof platformCommandNameSchema>;
