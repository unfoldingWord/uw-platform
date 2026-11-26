import type { AssistantChannel } from '@uw/contracts';
import type { AssistantSettingsRow } from '../ports.ts';

export const DEFAULT_TIMEZONE = 'UTC';
const DEFAULT_DISPLAY_NAME = 'Assistant';

export type TurnContext = { readonly now: Date; readonly channel: AssistantChannel };

type Customisation = Pick<AssistantSettingsRow, 'displayName' | 'instructionsMd' | 'timezone'>;

function addendum(settings: Customisation | null): readonly string[] {
  const text = settings?.instructionsMd.trim() ?? '';
  if (text === '') return [];
  return ["## The person's own instructions (the role's limits win)", '', text, ''];
}

export function instructionsOf(
  personaBody: string,
  settings: Customisation | null,
  context: TurnContext,
): string {
  return [
    personaBody.trimEnd(),
    '',
    ...addendum(settings),
    '## Context',
    '',
    `- Now: ${context.now.toISOString()}`,
    `- Timezone: ${settings?.timezone ?? DEFAULT_TIMEZONE}`,
    `- Your name: ${settings?.displayName ?? DEFAULT_DISPLAY_NAME}`,
    `- Channel: ${context.channel}`,
  ].join('\n');
}
