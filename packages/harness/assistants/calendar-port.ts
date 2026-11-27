import type { AssistantEffectFailure } from '@uw/contracts';
import { refused, type Refused } from '../outcome.ts';
import type { CalendarFailure } from '../ports.ts';

export type CalendarTrouble = CalendarFailure | 'not_wired';

export async function askCalendar<T>(work: () => Promise<T>): Promise<T | 'not_wired'> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof Error && error.name === 'PortNotWiredError') return 'not_wired';
    throw error;
  }
}

export function calendarRefusal(trouble: CalendarTrouble): Refused {
  if (trouble === 'not_wired') return refused('not_wired', { why: 'calendar_not_wired' });
  if (trouble === 'refused') return refused('not_permitted', { why: 'calendar_refused' });
  return refused('internal_error', { why: 'calendar_unavailable' });
}

export function calendarFailure(trouble: CalendarTrouble): AssistantEffectFailure {
  if (trouble === 'not_wired') return 'not_wired';
  return trouble === 'refused' ? 'calendar_refused' : 'calendar_unavailable';
}
