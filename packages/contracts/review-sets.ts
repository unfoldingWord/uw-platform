import { z } from 'zod';

export const QUOTE_CONTEXT_LENGTH = 32;

export const suggestedChangeKindSchema = z.enum([
  'insertion',
  'deletion',
  'replacement',
  'comment',
]);

export type SuggestedChangeKind = z.infer<typeof suggestedChangeKindSchema>;

export const reviewSetStatusSchema = z.enum(['pending', 'accepted', 'rejected']);

export type ReviewSetStatus = z.infer<typeof reviewSetStatusSchema>;

export const pageExportModeSchema = z.enum(['marked', 'accepted', 'original']);

export type PageExportMode = z.infer<typeof pageExportModeSchema>;

const offset = z.number().int().min(0).max(1_000_000);

export const textAnchorSchema = z
  .strictObject({
    start: offset,
    end: offset,
    exact: z.string().max(100_000),
    prefix: z.string().max(QUOTE_CONTEXT_LENGTH),
    suffix: z.string().max(QUOTE_CONTEXT_LENGTH),
  })
  .refine((anchor) => anchor.end - anchor.start === anchor.exact.length, { path: ['end'] });

export type TextAnchor = z.infer<typeof textAnchorSchema>;

const proposedText = z.string().max(100_000);

const note = z.string().trim().min(1).max(4_000).nullable();

function kindFits(change: {
  readonly kind: SuggestedChangeKind;
  readonly anchor: TextAnchor;
  readonly text: string;
  readonly note: string | null;
}): boolean {
  const spans = change.anchor.end > change.anchor.start;
  const writes = change.text.length > 0;
  if (change.kind === 'insertion') return !spans && writes && change.anchor.exact === '';
  if (change.kind === 'deletion') return spans && !writes;
  if (change.kind === 'replacement') return spans && writes;
  return !writes && change.note !== null;
}

export const suggestedChangeInputSchema = z
  .strictObject({
    kind: suggestedChangeKindSchema,
    anchor: textAnchorSchema,
    text: proposedText,
    note,
  })
  .refine(kindFits, { path: ['kind'] });

export type SuggestedChangeInput = z.infer<typeof suggestedChangeInputSchema>;

export const proposeReviewSetCommandSchema = z.strictObject({
  command: z.literal('propose_review_set'),
  requestId: z.uuid(),
  pageId: z.uuid(),
  baseVersion: z.number().int().min(1),
  name: z.string().trim().min(1).max(200),
  changes: z.array(suggestedChangeInputSchema).min(1).max(500),
});

export type ProposeReviewSetCommand = z.infer<typeof proposeReviewSetCommandSchema>;

export const acceptReviewSetCommandSchema = z.strictObject({
  command: z.literal('accept_review_set'),
  requestId: z.uuid(),
  reviewSetId: z.uuid(),
  revision: z.number().int().min(1),
});

export type AcceptReviewSetCommand = z.infer<typeof acceptReviewSetCommandSchema>;

export const rejectReviewSetCommandSchema = z.strictObject({
  command: z.literal('reject_review_set'),
  requestId: z.uuid(),
  reviewSetId: z.uuid(),
  revision: z.number().int().min(1),
});

export type RejectReviewSetCommand = z.infer<typeof rejectReviewSetCommandSchema>;
