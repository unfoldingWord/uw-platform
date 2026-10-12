import type { Harness, Stage } from '@uw/contracts';
import { isAgent } from '../access.ts';
import type { Caller } from '../caller.ts';
import { refused, type Refused } from '../outcome.ts';

export function pausedRefusal(
  caller: Caller,
  harness: Pick<Harness, 'paused'>,
  stage: Pick<Stage, 'key' | 'paused'>,
): Refused | null {
  if (!isAgent(caller.actor) || (!harness.paused && !stage.paused)) return null;
  return refused('not_permitted', { why: 'paused', stage: stage.key });
}
