import {
  customiseAssistantCommandSchema,
  decideAssistantProposalCommandSchema,
  disablePersonAssistantCommandSchema,
  deleteMyAssistantHistoryCommandSchema,
  disableAssistantCommandSchema,
  enableAssistantCommandSchema,
  grantAssistCommandSchema,
  renewAssistCommandSchema,
  revokeAssistCommandSchema,
  setAssistantBudgetCommandSchema,
  undoAssistantEffectCommandSchema,
} from '@uw/contracts';
import type { ZodType } from 'zod';

type Given = ReadonlyMap<string, string>;
type Shape = (given: Given) => Readonly<Record<string, unknown>>;

const calendarDay = /^\d{4}-\d{2}-\d{2}$/;
const whole = /^\d{1,7}$/;
const cents = /^\d{1,2}$/;
const MINOR_PER_DOLLAR = 100;

function dayEnd(day: string | undefined): string | null | undefined {
  if (day === undefined || day === '') return null;
  return calendarDay.test(day) ? `${day}T23:59:59.000Z` : undefined;
}

function minorOf(text: string | undefined): number | null | undefined {
  const trimmed = (text ?? '').trim();
  if (trimmed === '') return null;
  const [units = '', fraction, extra] = trimmed.split('.');
  const shaped = whole.test(units) && extra === undefined;
  if (!shaped || (fraction !== undefined && !cents.test(fraction))) return undefined;
  return Math.round(Number(trimmed) * MINOR_PER_DOLLAR);
}

const none: Shape = () => ({});
const ending: Shape = (given) => ({ expiresAt: dayEnd(given.get('expiresOn')) });

export const assistantShapes: ReadonlyMap<string, Shape> = new Map<string, Shape>([
  ['enable_assistant', (given) => ({ name: (given.get('name') ?? '').trim().toLowerCase() })],
  ['disable_assistant', none],
  ['grant_assist', ending],
  ['renew_assist', ending],
  ['revoke_assist', none],
  ['delete_my_assistant_history', none],
  ['undo_assistant_effect', (given) => ({ effectId: given.get('effectId') })],
  [
    'decide_assistant_proposal',
    (given) => ({
      proposalId: given.get('proposalId'),
      decision: given.get('decision'),
      digest: given.get('digest'),
    }),
  ],
  [
    'customise_assistant',
    (given) => ({
      displayName: given.get('displayName'),
      timezone: given.get('timezone'),
      instructionsMd: given.get('instructionsMd') ?? '',
      expectedVersion: Number(given.get('expectedVersion')),
    }),
  ],
  [
    'set_assistant_budget',
    (given) => ({
      personId: given.get('personId'),
      monthlyMinor: minorOf(given.get('monthlyDollars')),
    }),
  ],
  ['disable_person_assistant', (given) => ({ personId: given.get('personId') })],
]);

export const assistantSchemas: ReadonlyMap<string, ZodType> = new Map<string, ZodType>([
  ['enable_assistant', enableAssistantCommandSchema],
  ['disable_assistant', disableAssistantCommandSchema],
  ['grant_assist', grantAssistCommandSchema],
  ['renew_assist', renewAssistCommandSchema],
  ['revoke_assist', revokeAssistCommandSchema],
  ['delete_my_assistant_history', deleteMyAssistantHistoryCommandSchema],
  ['undo_assistant_effect', undoAssistantEffectCommandSchema],
  ['customise_assistant', customiseAssistantCommandSchema],
  ['set_assistant_budget', setAssistantBudgetCommandSchema],
  ['decide_assistant_proposal', decideAssistantProposalCommandSchema],
  ['disable_person_assistant', disablePersonAssistantCommandSchema],
]);
