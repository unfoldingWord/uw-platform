import { assistantPersonOf, type Harness, type Identity } from '@uw/contracts';
import { refused, type Refused } from '../outcome.ts';

export function personaHarnessRefusal(
  identity: Identity,
  harness: Pick<Harness, 'personId'>,
): Refused | null {
  return assistantPersonOf(identity) === harness.personId
    ? null
    : refused('not_permitted', { why: 'persona_not_for_harness' });
}
