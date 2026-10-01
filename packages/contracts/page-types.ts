import { z } from 'zod';
import {
  capabilityWordSchema,
  engineSchema,
  evidenceLabelSchema,
  runShapeSchema,
  type Classification,
  type OfflineEligibility,
} from './closed-sets.ts';
import { identitySchema } from './identity.ts';
import { slugSchema, type PageType } from './pages.ts';
import { verbNameSchema } from './verb-names.ts';

const text = z.string().min(1).max(2000);
const distinct = <T>(values: readonly T[]) => new Set(values).size === values.length;
const humanIdentity = identitySchema.refine((value) => value.startsWith('human:'));
const agentIdentity = identitySchema.refine(
  (value) => value.startsWith('agent:') && !value.includes('/'),
);

export const dataSourceKindSchema = z.enum(['web_analytics', 'mailing_list', 'manual']);

export const skillFrontmatterSchema = z.strictObject({
  name: slugSchema.max(64),
  description: z.string().min(1).max(1024),
});

export const learningFrontmatterSchema = z.strictObject({
  confidence: evidenceLabelSchema,
  as_of: z.iso.date(),
  supersedes: z.array(z.uuid()),
  review_by: z.iso.date().nullable(),
});

export const personaFrontmatterSchema = z.strictObject({
  identity: agentIdentity,
  owner: humanIdentity,
  harness: z.uuid(),
  toolset: z.array(verbNameSchema).refine(distinct, 'a toolset names each verb once'),
  run_shape: runShapeSchema,
  engine: engineSchema,
  model: z.string().min(1).max(200),
  budget: z.strictObject({
    monthly_minor: z.number().int().min(0),
    currency: z.string().regex(/^[A-Z]{3}$/),
  }),
  capability: capabilityWordSchema,
  requires_tools: z.array(z.string().regex(/^[a-z][a-z_]*$/)).refine(distinct),
});

export const productFrontmatterSchema = z.strictObject({ owner: humanIdentity, summary: text });

export const systemGoalFrontmatterSchema = z.strictObject({
  statement: text,
  measure: text,
  horizon: z.iso.date(),
});

export const productStrategyFrontmatterSchema = z.strictObject({ niche: text, hypothesis: text });

export const dataSourcesFrontmatterSchema = z.strictObject({
  sources: z
    .array(
      z.strictObject({
        name: z.string().min(1).max(200),
        kind: dataSourceKindSchema,
        url: z.url().nullable(),
      }),
    )
    .min(1),
});

export type PageTypeDefinition = {
  readonly frontmatter: z.ZodType;
  readonly classification: Classification;
  readonly offlineEligibility: OfflineEligibility;
};

const internalSync = { classification: 'internal', offlineEligibility: 'sync' } as const;

export const pageTypeRegistry = {
  skill: { frontmatter: skillFrontmatterSchema, ...internalSync },
  learning: { frontmatter: learningFrontmatterSchema, ...internalSync },
  persona: { frontmatter: personaFrontmatterSchema, ...internalSync },
  product: { frontmatter: productFrontmatterSchema, ...internalSync },
  system_goal: { frontmatter: systemGoalFrontmatterSchema, ...internalSync },
  product_strategy: { frontmatter: productStrategyFrontmatterSchema, ...internalSync },
  data_sources: { frontmatter: dataSourcesFrontmatterSchema, ...internalSync },
} as const satisfies Record<PageType, PageTypeDefinition>;

const byType = new Map<string, PageTypeDefinition>(Object.entries(pageTypeRegistry));

export function pageTypeDefinition(type: string): PageTypeDefinition | undefined {
  return byType.get(type);
}
