import { z } from 'zod';
import { jdAreaSchema, jdCategorySchema, jdIdSchema } from './areas.ts';
import { pageSchema, pageTypeSchema } from './pages.ts';

const instant = z.iso.datetime();

export const pageEntrySchema = pageSchema
  .pick({ id: true, type: true, jdArea: true, slug: true, title: true, status: true })
  .extend({
    parentId: z.uuid().nullable(),
    version: z.number().int().min(1),
    category: jdCategorySchema.nullable(),
    jdId: jdIdSchema.nullable(),
    updatedAt: instant,
  });

export const pageListQuerySchema = z.object({
  area: jdAreaSchema.optional(),
  category: jdCategorySchema.optional(),
  parent: z.union([z.uuid(), z.literal('none')]).optional(),
  type: pageTypeSchema.optional(),
  cursor: z.string().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const pageListReplySchema = z.object({
  pages: z.array(pageEntrySchema),
  next: z.string().nullable(),
});

export const pageCapabilitiesSchema = z.object({
  canEdit: z.boolean(),
  canRetire: z.boolean(),
  canComment: z.boolean(),
});

export const pageHeadingSchema = z.object({
  depth: z.union([z.literal(2), z.literal(3)]),
  id: z.string().min(1),
  text: z.string(),
});

export const pageReadReplySchema = z.object({
  page: pageSchema,
  capabilities: pageCapabilitiesSchema,
  html: z.string().optional(),
  headings: z.array(pageHeadingSchema).optional(),
});

export const pageIndexEntrySchema = z.object({
  id: z.uuid(),
  title: z.string(),
  type: pageTypeSchema,
  jdArea: jdAreaSchema,
  jdId: jdIdSchema.nullable(),
  aliases: z.array(z.string()),
});

export const pageIndexReplySchema = z.object({ entries: z.array(pageIndexEntrySchema) });

export const pageSearchQuerySchema = z.object({
  q: z.string().min(1).max(200),
  type: pageTypeSchema.optional(),
  area: jdAreaSchema.optional(),
  titles: z.enum(['1']).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const snippetPartSchema = z.object({ text: z.string(), hit: z.boolean() });

export const pageSearchReplySchema = z.object({
  results: z.array(
    z.object({
      page: pageSchema.pick({
        id: true,
        type: true,
        jdArea: true,
        slug: true,
        title: true,
        status: true,
      }),
      snippet: z.array(snippetPartSchema),
    }),
  ),
});

export const pageVersionEntrySchema = z.object({
  version: z.number().int().min(1),
  title: z.string(),
  savedAt: instant,
  savedBy: z.string(),
});

export const pageVersionsReplySchema = z.object({ versions: z.array(pageVersionEntrySchema) });

export const pageVersionReplySchema = z.object({
  page: pageSchema,
  savedAt: instant,
  savedBy: z.string(),
});

export const pageCommandAcceptedSchema = z.object({
  status: z.literal('accepted'),
  requestId: z.uuid(),
  pageId: z.uuid(),
  version: z.number().int().min(1),
});

export type PageEntry = z.infer<typeof pageEntrySchema>;
export type PageListQuery = z.infer<typeof pageListQuerySchema>;
export type PageCapabilities = z.infer<typeof pageCapabilitiesSchema>;
export type PageIndexEntry = z.infer<typeof pageIndexEntrySchema>;
export type PageSearchQuery = z.infer<typeof pageSearchQuerySchema>;
export type PageVersionEntry = z.infer<typeof pageVersionEntrySchema>;
