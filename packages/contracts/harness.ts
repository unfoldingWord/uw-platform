import { z } from 'zod';
import { jdAreaSchema } from './areas.ts';
import {
  agentPickupSchema,
  branchStateSchema,
  connectorSchema,
  exitGateSchema,
  gateStatusSchema,
  principalKindSchema,
  riskDomainsSchema,
  riskTierSchema,
  stageBracketSchema,
} from './closed-sets.ts';
import { agentIdentityPattern, identitySchema, isPersonaIdentity } from './identity.ts';
import { fullShaSchema, requiredChecksSchema } from './ship-rule.ts';
import { slugSchema } from './pages.ts';

const distinct = (values: readonly string[]) => new Set(values).size === values.length;

export const stageKeyPattern = '^[a-z][a-z0-9_]{0,63}$';
export const stageKeySchema = z
  .string()
  .regex(new RegExp(stageKeyPattern), 'a stage key is lowercase snake_case');

export const personaIdentityPattern = agentIdentityPattern;
export const personaIdentitySchema = identitySchema.refine(
  isPersonaIdentity,
  'a persona identity is agent:<persona>, not a reserved name',
);

export const repositoryPattern =
  '^(?!-)(?![A-Za-z0-9-]*-/)[A-Za-z0-9-]{1,39}/(?!\\.\\.?$)[A-Za-z0-9._-]{1,100}$';
export const repositorySchema = z
  .string()
  .regex(new RegExp(repositoryPattern), 'a repository is a GitHub owner/name');

export const pullRequestRefSchema = z.strictObject({
  repo: repositorySchema,
  number: z.number().int().min(1),
});

export const issueRefSchema = z.strictObject({
  repo: repositorySchema,
  number: z.number().int().min(1),
  githubId: z.number().int().min(1),
});

export const githubLoginPattern = '^[A-Za-z0-9][A-Za-z0-9-]{0,38}(?:\\[bot\\])?$';
export const githubLoginSchema = z
  .string()
  .regex(new RegExp(githubLoginPattern), 'a GitHub login, with [bot] for an app');

const distinctInAnyCase = (values: readonly string[]) =>
  new Set(values.map((value) => value.toLowerCase())).size === values.length;

export const externalReviewerIdentitiesSchema = z
  .array(githubLoginSchema)
  .max(20)
  .refine(distinctInAnyCase, 'each login once, in any case');

const protectedPathPattern = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[^\s\\]{1,200}$/;
export const protectedPathSchema = z
  .string()
  .regex(protectedPathPattern, 'a protected path is repository-relative, with no dot-dot segment');
export const protectedPathsSchema = z
  .array(protectedPathSchema)
  .max(50)
  .refine(distinct, 'each protected path once');

export const harnessSchema = z.strictObject({
  id: z.uuid(),
  key: slugSchema,
  template: slugSchema,
  jdArea: jdAreaSchema,
  repository: repositorySchema.nullable(),
  hostedBuilderEnabled: z.boolean(),
  paused: z.boolean(),
  shadow: z.boolean().default(false),
  externalReviewerIdentities: externalReviewerIdentitiesSchema.default([]),
  frozen: z.boolean().default(false),
  freezeAllow: z.array(z.uuid()).max(100).default([]),
  requiredChecks: requiredChecksSchema.default([]),
  protectedPaths: protectedPathsSchema.default([]),
  fixClaim: z.boolean().default(false),
});

export const stageSchema = z.strictObject({
  id: z.uuid(),
  harnessId: z.uuid(),
  key: stageKeySchema,
  title: z.string().min(1).max(120),
  position: z.number().int().min(1),
  bracket: stageBracketSchema,
  agentPickup: agentPickupSchema,
  exitGate: exitGateSchema,
  connector: connectorSchema,
  wipLimit: z.number().int().min(1),
  instructionsPageId: z.uuid().nullable(),
  validators: z
    .array(z.string().regex(/^[a-z][a-z0-9_]*$/))
    .refine(distinct, 'a stage names each validator once'),
  feeds: z.array(stageKeySchema).refine(distinct, 'a stage names each feeds target once'),
  paused: z.boolean(),
});

export const itemStateSchema = z.strictObject({
  itemId: z.uuid(),
  harnessId: z.uuid(),
  stageKey: stageKeySchema,
  title: z.string().min(1).max(200),
  pageId: z.uuid().nullable(),
  priority: z.number().int(),
  due: z.iso.date().nullable(),
  holder: identitySchema.nullable(),
  claimantKind: principalKindSchema.nullable(),
  delegationId: z.uuid().nullable(),
  leaseExpiresAt: z.iso.datetime().nullable(),
  gateStatus: gateStatusSchema,
  gateTarget: stageKeySchema.nullable(),
  branchState: branchStateSchema,
  expectedHead: fullShaSchema.nullable(),
  riskTier: riskTierSchema.nullable(),
  riskDomains: riskDomainsSchema,
  pullRequest: pullRequestRefSchema.nullable(),
  issue: issueRefSchema.nullable(),
  zulipTopic: z.string().min(1).nullable(),
});

export type Harness = z.infer<typeof harnessSchema>;
export type Stage = z.infer<typeof stageSchema>;
export type ItemState = z.infer<typeof itemStateSchema>;
export type IssueRef = z.infer<typeof issueRefSchema>;
