import type { Harness } from '@uw/contracts';
import { draft, recordHarnessEvents, type RecordContext } from '../items/record.ts';
import { lockKeys } from '../lock-keys.ts';
import type { StoreTransaction } from '../ports.ts';
import type { Template } from '../templates/types.ts';

export async function insertPersonalHarness(
  tx: StoreTransaction,
  context: RecordContext,
  harness: Harness,
  template: Template,
): Promise<void> {
  if (harness.personId === null || template.personal !== true || template.stages.length > 0) {
    throw new RangeError('only a personal template without stages makes a personal harness');
  }
  await tx.lock(lockKeys.harnessStages(harness.id));
  await tx.harnesses.write.insert(harness, context.at);
  await recordHarnessEvents(tx, context, harness.id, [
    draft('template_activated', {
      template: template.key,
      stages: [],
      repository: null,
      shadow: false,
    }),
  ]);
}

export async function retitlePersonal(
  tx: StoreTransaction,
  context: RecordContext,
  harness: Harness,
  title: string,
): Promise<void> {
  if (harness.personId === null) throw new RangeError('only a personal harness is retitled here');
  if (harness.title === title) return;
  await tx.lock(lockKeys.harnessStages(harness.id));
  if (!(await tx.harnesses.write.setTitle(harness.id, title))) return;
  await recordHarnessEvents(tx, context, harness.id, [
    draft('title_set', { from: harness.title, to: title }),
  ]);
}
