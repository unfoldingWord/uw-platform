import { z } from 'zod';
import { jdAreaSchema, jdCategorySchema } from './areas.ts';

export const pageTypes = [
  'skill',
  'learning',
  'persona',
  'product',
  'system_goal',
  'product_strategy',
  'data_sources',
  'issue',
  'platform',
  'decision',
  'knowledge',
  'entry',
  'profile',
  'policy',
  'portfolio',
  'program',
  'project',
  'okr',
  'charter',
] as const;

export const collectionPageTypes = ['entry', 'portfolio', 'program', 'project', 'okr'] as const;

const collectionPageTypeSet: ReadonlySet<string> = new Set(collectionPageTypes);

export function isCollectionPageType(type: string): boolean {
  return collectionPageTypeSet.has(type);
}

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

export const nameCategoryCommandSchema = z.object({
  command: z.literal('name_category'),
  requestId: z.uuid(),
  category: jdCategorySchema,
  name: z
    .string()
    .max(80)
    .refine((value) => value.trim().length > 0, 'a category name is not blank'),
});

export const movePageCommandSchema = z.object({
  command: z.literal('move_page'),
  requestId: z.uuid(),
  pageId: z.uuid(),
  expectedVersion: z.number().int().min(1),
  category: jdCategorySchema,
  parentId: z.uuid().nullable(),
});

export const commentPageCommandSchema = z.object({
  command: z.literal('comment_page'),
  requestId: z.uuid(),
  commentId: z.uuid(),
  pageId: z.uuid(),
  bodyMd: z
    .string()
    .max(10_000)
    .refine((value) => value.trim().length > 0, 'a comment is not blank'),
  quote: z
    .string()
    .max(500)
    .refine((value) => value.trim().length > 0, 'a quoted passage is not blank')
    .nullable()
    .default(null),
});

export const setAreaHomeCommandSchema = z.object({
  command: z.literal('set_area_home'),
  requestId: z.uuid(),
  area: jdAreaSchema,
  pageId: z.uuid().nullable(),
});

export type SetAreaHomeCommand = z.infer<typeof setAreaHomeCommandSchema>;

export const resolveCommentCommandSchema = z.object({
  command: z.literal('resolve_comment'),
  requestId: z.uuid(),
  commentId: z.uuid(),
});

export type CommentPageCommand = z.infer<typeof commentPageCommandSchema>;
export type ResolveCommentCommand = z.infer<typeof resolveCommentCommandSchema>;
export type MovePageCommand = z.infer<typeof movePageCommandSchema>;
export type NameCategoryCommand = z.infer<typeof nameCategoryCommandSchema>;
export type PageType = z.infer<typeof pageTypeSchema>;
export type PageStatus = z.infer<typeof pageStatusSchema>;
export type Page = z.infer<typeof pageSchema>;
export type CreatePageCommand = z.infer<typeof createPageCommandSchema>;
export type UpdatePageCommand = z.infer<typeof updatePageCommandSchema>;
export type ConfirmPageCommand = z.infer<typeof confirmPageCommandSchema>;
