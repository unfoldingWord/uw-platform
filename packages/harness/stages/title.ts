import { harnessTitleSchema } from '@uw/contracts';
import type { Caller } from '../caller.ts';
import { draft, recordContext, recordHarnessEvents } from '../items/record.ts';
import { lockKeys } from '../lock-keys.ts';
import { accepted, refused, type KernelOutcome } from '../outcome.ts';
import type { Ports } from '../ports.ts';
import type { HarnessScene } from '../reads/scene.ts';
import { adminRefusal, agentRefusal } from './rules.ts';

type SwitchPorts = Pick<Ports, 'clock' | 'grants' | 'ids' | 'store'>;

export type TitleInput = { readonly harnessId: string; readonly title: string };

export async function setTitle(
  ports: SwitchPorts,
  caller: Caller,
  input: TitleInput,
): Promise<KernelOutcome<HarnessScene>> {
  const agent = agentRefusal(caller);
  if (agent !== null) return agent;
  const parsed = harnessTitleSchema.safeParse(input.title);
  if (!parsed.success) return refused('malformed_command', { field: 'title' });
  const title = parsed.data;
  const at = ports.clock.now();
  return ports.store.transaction(async (tx) => {
    await tx.lock(lockKeys.harnessStages(input.harnessId));
    const harness = await tx.harnesses.read.byId(input.harnessId);
    if (harness === null) return refused('harness_not_found', { harnessId: input.harnessId });
    const denied = await adminRefusal(ports, tx, caller, harness, at);
    if (denied !== null) return denied;
    const stages = await tx.harnessStages.read.forHarness(harness.id);
    if (harness.title === title) return accepted({ harness, stages });
    if (!(await tx.harnesses.write.setTitle(harness.id, title))) {
      return refused('harness_not_found', { harnessId: harness.id });
    }
    await recordHarnessEvents(tx, recordContext(ports, caller, at), harness.id, [
      draft('title_set', { from: harness.title, to: title }),
    ]);
    return accepted({ harness: { ...harness, title }, stages });
  });
}
