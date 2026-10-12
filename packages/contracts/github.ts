import { z } from 'zod';
import { riskDomainsSchema, riskTierSchema } from './closed-sets.ts';

export const issueReferenceSchema = z
  .string()
  .regex(
    /^(?:#[1-9][0-9]{0,9}|[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+#[1-9][0-9]{0,9})$/u,
    'an issue reference is #N or owner/name#N',
  );

export const pullRequestDeclarationSchema = z.strictObject({
  closes: z.array(issueReferenceSchema),
  risks: z.string().min(1).max(500),
  touches: z.string().min(1).max(500),
  riskTier: riskTierSchema,
  riskDomains: riskDomainsSchema,
});

export type PullRequestDeclaration = z.infer<typeof pullRequestDeclarationSchema>;
