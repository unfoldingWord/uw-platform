import { z } from 'zod';
import { jdAreaSchema } from './areas.ts';
import { sectionsIn, type Sections } from './sections.ts';

export const policyLevelSchema = z.enum([
  'organization',
  'portfolio',
  'program',
  'project',
  'product',
]);

export type PolicyLevel = z.infer<typeof policyLevelSchema>;

export const policyEnforcementSchema = z.enum(['required', 'default', 'template']);

export type PolicyEnforcement = z.infer<typeof policyEnforcementSchema>;

const distinct = <T>(values: readonly T[]) => new Set(values).size === values.length;

export const templateSourceSchema = z.strictObject({
  page_id: z.uuid(),
  version: z.number().int().min(1),
});

export type TemplateSource = z.infer<typeof templateSourceSchema>;

const boundEnforcementSchema = z.enum(['required', 'default']);

export const copyTemplatePolicyCommandSchema = z.object({
  command: z.literal('copy_template_policy'),
  requestId: z.uuid(),
  pageId: z.uuid(),
  templateId: z.uuid(),
  jdArea: jdAreaSchema,
  title: z.string().min(1).max(200),
  enforcement: boundEnforcementSchema,
  appliesTo: z.uuid().nullable(),
  effectiveFrom: z.iso.date(),
});

export type CopyTemplatePolicyCommand = z.infer<typeof copyTemplatePolicyCommandSchema>;

export const adoptTemplateUpdateCommandSchema = z.object({
  command: z.literal('adopt_template_update'),
  requestId: z.uuid(),
  pageId: z.uuid(),
  expectedVersion: z.number().int().min(1),
  templateVersion: z.number().int().min(1),
});

export type AdoptTemplateUpdateCommand = z.infer<typeof adoptTemplateUpdateCommandSchema>;

export const policyFrontmatterSchema = z
  .strictObject({
    enforcement: policyEnforcementSchema,
    applies_to: z.uuid().nullable().default(null),
    supersedes: z
      .array(z.uuid())
      .max(20)
      .refine(distinct, 'a policy names each superseded policy once')
      .default([]),
    effective_from: z.iso.date(),
    effective_until: z.iso.date().nullable().default(null),
    copied_from: templateSourceSchema.nullable().default(null),
  })
  .refine(
    (value) => value.effective_until === null || value.effective_until > value.effective_from,
    'a policy stops after it starts',
  );

export type PolicyFrontmatter = z.infer<typeof policyFrontmatterSchema>;

export const charterFrontmatterSchema = z.strictObject({
  applies_to: z.uuid().nullable().default(null),
});

export const charterSectionSchema = z.enum([
  'Need',
  'Idea',
  'Strategy',
  'Outcomes',
  'Risks',
  'Roadmap',
]);

export type CharterSection = z.infer<typeof charterSectionSchema>;

export type CharterSections = Sections<CharterSection>;

export function charterSections(bodyMd: string): CharterSections {
  return sectionsIn(bodyMd, charterSectionSchema.options);
}

export const decisionFrontmatterSchema = z.strictObject({
  applies_to: z.uuid().nullable().default(null),
  decided_on: z.iso.date(),
  supersedes: z
    .array(z.uuid())
    .max(20)
    .refine(distinct, 'a decision names each superseded decision once')
    .default([]),
});

export type DecisionFrontmatter = z.infer<typeof decisionFrontmatterSchema>;

export const decisionSectionSchema = z.enum(['Context', 'Decision', 'Consequences']);

export type DecisionSection = z.infer<typeof decisionSectionSchema>;

export function decisionSections(bodyMd: string): Sections<DecisionSection> {
  return sectionsIn(bodyMd, decisionSectionSchema.options);
}
