import { z } from 'zod';

export const ASSISTANT_BUDGET_MOST_MINOR = 1_000_000;

export const setAssistantBudgetCommandSchema = z.strictObject({
  command: z.literal('set_assistant_budget'),
  requestId: z.uuid(),
  personId: z.uuid(),
  monthlyMinor: z.number().int().min(0).max(ASSISTANT_BUDGET_MOST_MINOR).nullable(),
});

export type SetAssistantBudgetCommand = z.infer<typeof setAssistantBudgetCommandSchema>;
