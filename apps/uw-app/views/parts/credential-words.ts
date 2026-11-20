import { formatDate, formatInstant } from '@uw/core/dates';
import { reasonText } from '@uw/ui/components/text.ts';
import type { CredentialLine, LogLine } from '../../credentials/records.ts';

type Choice = { readonly value: string; readonly label: string };

const kinds: ReadonlyMap<string, string> = new Map([
  ['api_key', 'API key'],
  ['oauth_refresh', 'OAuth refresh token'],
  ['password', 'Password'],
  ['ssh_key', 'SSH key'],
  ['certificate', 'Certificate'],
]);

export const kindChoices: readonly Choice[] = [...kinds].map(([value, label]) => ({
  value,
  label,
}));

export function kindWord(kind: string): string {
  return kinds.get(kind) ?? kind;
}

const connectorNames: ReadonlyMap<string, string> = new Map([
  ['merge', 'Merge'],
  ['deploy', 'Deploy'],
  ['publish', 'Publish'],
  ['send', 'Send'],
  ['post', 'Post'],
]);

export const connectorChoices: readonly Choice[] = [...connectorNames].map(([value, label]) => ({
  value,
  label,
}));

export function connectorWord(key: string): string {
  return connectorNames.get(key) ?? key;
}

export const revealWindows: readonly Choice[] = [
  { value: '15', label: '15 minutes' },
  { value: '60', label: '1 hour' },
  { value: '240', label: '4 hours' },
  { value: '1440', label: '24 hours' },
];

const actions: ReadonlyMap<string, string> = new Map([
  ['create', 'Added'],
  ['rotate', 'Rotated'],
  ['revoke', 'Revoked'],
  ['bind', 'Bound'],
  ['unbind', 'Unbound'],
  ['use', 'Used'],
  ['reveal', 'Revealed'],
  ['grant_reveal', 'Gave a reveal grant'],
  ['confirm_reveal', 'Confirmed a reveal grant'],
  ['revoke_reveal', 'Revoked a reveal grant'],
]);

export function actionWord(action: string): string {
  return actions.get(action) ?? reasonText(action);
}

export function outcomeWord(line: Pick<LogLine, 'outcome' | 'reason'>): string {
  if (line.outcome === 'done') return 'Done';
  return `Refused: ${reasonText(line.reason ?? 'not_permitted').toLowerCase()}`;
}

export function actorWord(line: Pick<LogLine, 'actor' | 'person'>): string {
  const person = line.person ?? 'nobody';
  if (line.actor.startsWith('human:')) return person;
  return line.actor.startsWith('agent:') ? `An agent for ${person}` : 'The platform';
}

type Standing = 'active' | 'revoked' | 'expired';

export function standingOf(line: Pick<CredentialLine, 'revokedAt' | 'expiresAt'>, at: Date) {
  if (line.revokedAt !== null) return 'revoked' satisfies Standing;
  const expired = line.expiresAt !== null && line.expiresAt.getTime() <= at.getTime();
  return expired ? ('expired' satisfies Standing) : ('active' satisfies Standing);
}

export function rotationDue(line: Pick<CredentialLine, 'rotateBy'>, at: Date): boolean {
  return line.rotateBy !== null && line.rotateBy < formatDate(at);
}

export function dayOrNone(day: string | null): string {
  return day ?? 'No date';
}

export function instantOrNone(at: Date | null, none: string): string {
  return at === null ? none : formatInstant(at);
}
