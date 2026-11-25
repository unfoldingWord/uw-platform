import { z } from 'zod';

export const suggestionSetStatusSchema = z.enum(['pending', 'accepted', 'rejected']);

export type SuggestionSetStatus = z.infer<typeof suggestionSetStatusSchema>;

export const acceptSuggestionCommandSchema = z.object({
  command: z.literal('accept_suggestion'),
  requestId: z.uuid(),
  suggestionId: z.uuid(),
});

export type AcceptSuggestionCommand = z.infer<typeof acceptSuggestionCommandSchema>;

export const rejectSuggestionCommandSchema = z.object({
  command: z.literal('reject_suggestion'),
  requestId: z.uuid(),
  suggestionId: z.uuid(),
});

export type RejectSuggestionCommand = z.infer<typeof rejectSuggestionCommandSchema>;
