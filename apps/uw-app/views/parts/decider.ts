import type { Principal } from '@uw/contracts';
import type { DecideAbility } from '@uw/harness';

function personAtKeyboard(actor: Principal): boolean {
  return (
    actor.kind === 'person' &&
    actor.personId !== null &&
    actor.identity === `human:${actor.personId}`
  );
}

export function showsDecisions(actor: Principal, ability: DecideAbility): boolean {
  if (!personAtKeyboard(actor)) return false;
  return ability.can || ability.reason !== 'item_not_at_gate';
}
