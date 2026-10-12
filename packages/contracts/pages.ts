import { z } from 'zod';
import { jdAreaSchema } from './areas.ts';

export const pageTypes = [
  'skill',
  'learning',
  'persona',
  'product',
  'system_goal',
  'product_strategy',
  'data_sources',
  'issue',
] as const;

export const pageTypeSchema = z.enum(pageTypes);
export const pageStatusSchema = z.enum(['draft', 'suggested', 'active', 'retired']);
export const slugSchema = z
  .string()
  .max(120)
  .regex(/^[a-z0-9-]+$/, 'a slug is lowercase kebab-case')
  .regex(/^[^-]/, 'a slug does not start with a hyphen')
  .regex(/[^-]$/, 'a slug does not end with a hyphen')
  .refine((value) => !value.includes('--'), 'a slug has no empty segment');
export const frontmatterSchema = z.record(z.string(), z.json());

const title = z
  .string()
  .max(200)
  .refine((value) => value.trim().length > 0, 'a title is not blank');
const bodyMd = z.string().max(1_000_000);

export const pageSchema = z.object({
  id: z.uuid(),
  type: pageTypeSchema,
  jdArea: jdAreaSchema,
  slug: slugSchema,
  title,
  parentId: z.uuid().nullable(),
  frontmatter: frontmatterSchema,
  bodyMd,
  version: z.number().int().min(1),
  status: pageStatusSchema,
});

const editable = {
  slug: slugSchema,
  title,
  parentId: z.uuid().nullable(),
  frontmatter: frontmatterSchema,
  bodyMd,
  status: pageStatusSchema,
};

export const createPageCommandSchema = z.object({
  command: z.literal('create_page'),
  requestId: z.uuid(),
  pageId: z.uuid(),
  type: z.string().min(1).max(64),
  jdArea: jdAreaSchema,
  ...editable,
});

export const updatePageCommandSchema = z.object({
  command: z.literal('update_page'),
  requestId: z.uuid(),
  pageId: z.uuid(),
  expectedVersion: z.number().int().min(1),
  ...editable,
});

export const confirmPageCommandSchema = z.object({
  command: z.literal('confirm_page'),
  requestId: z.uuid(),
  pageId: z.uuid(),
  expectedVersion: z.number().int().min(1),
});

export type PageType = z.infer<typeof pageTypeSchema>;
export type PageStatus = z.infer<typeof pageStatusSchema>;
export type Page = z.infer<typeof pageSchema>;
export type CreatePageCommand = z.infer<typeof createPageCommandSchema>;
export type UpdatePageCommand = z.infer<typeof updatePageCommandSchema>;
export type ConfirmPageCommand = z.infer<typeof confirmPageCommandSchema>;
