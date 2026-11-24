import { z } from 'zod';
import { collectionKeySchema } from './collections.ts';

export const pdfExportKinds = ['page', 'view', 'screen', 'binder'] as const;

export const pdfExportStatuses = ['queued', 'ready', 'failed', 'expired'] as const;

export const binderLimit = 50;

export const pdfExportKindSchema = z.enum(pdfExportKinds);

export const pdfExportStatusSchema = z.enum(pdfExportStatuses);

const binderTitle = z.string().trim().min(1).max(200);
const binderPages = z.array(z.uuid()).min(1).max(binderLimit);

const binderByRoot = z.strictObject({
  kind: z.literal('binder'),
  title: binderTitle.optional(),
  rootPageId: z.uuid(),
});

export const binderRequestSchema = z.union([
  z.strictObject({ kind: z.literal('binder'), title: binderTitle, pageIds: binderPages }),
  binderByRoot,
]);

export const pdfTargetSchema = z.union([
  z.strictObject({ kind: z.literal('page'), pageId: z.uuid() }),
  z.strictObject({ kind: z.literal('view'), collection: collectionKeySchema, viewId: z.uuid() }),
  z.strictObject({
    kind: z.literal('binder'),
    title: binderTitle.optional(),
    pageIds: binderPages,
  }),
  binderByRoot,
]);

export const pdfExportReplySchema = z.strictObject({
  exportId: z.uuid(),
  status: pdfExportStatusSchema,
  file: z.string(),
  sha256: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .nullable(),
  bytes: z.number().int().nonnegative().nullable(),
});

export type PdfExportKind = z.infer<typeof pdfExportKindSchema>;
export type PdfExportStatus = z.infer<typeof pdfExportStatusSchema>;
export type BinderRequest = z.infer<typeof binderRequestSchema>;
export type PdfTarget = z.infer<typeof pdfTargetSchema>;
export type PdfExportReply = z.infer<typeof pdfExportReplySchema>;
