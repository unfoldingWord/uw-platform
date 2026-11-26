import {
  assistantSettingsSchema,
  type AssistantSettingField,
  type AssistantSettings,
} from '@uw/contracts';
import { knownTimeZone } from '@uw/core/dates';
import { isAgent } from '../access.ts';
import type { Caller } from '../caller.ts';
import { draft, recordContext, recordHarnessEvents } from '../items/record.ts';
import { accepted, refused, type KernelOutcome, type Refused } from '../outcome.ts';
import type { AssistantSettingsRow, Ports, StoreTransaction } from '../ports.ts';

export type CustomiseInput = {
  readonly harnessId: string;
  readonly settings: AssistantSettings;
  readonly expectedVersion: number;
};

type SettingsPorts = Pick<Ports, 'clock' | 'grants' | 'ids' | 'store'>;

export function changedFields(
  before: AssistantSettingsRow | null,
  after: AssistantSettings,
): readonly AssistantSettingField[] {
  const fields: AssistantSettingField[] = [];
  if (before?.displayName !== after.displayName) fields.push('display_name');
  if (before?.instructionsMd !== after.instructionsMd) fields.push('instructions');
  if (before?.timezone !== after.timezone) fields.push('timezone');
  return fields;
}

function inputRefusal(input: CustomiseInput): AssistantSettings | Refused {
  const parsed = assistantSettingsSchema.safeParse(input.settings);
  if (!parsed.success) return refused('malformed_command', { why: 'assistant_settings' });
  if (!knownTimeZone(parsed.data.timezone))
    return refused('malformed_command', { why: 'timezone' });
  const version = input.expectedVersion;
  return Number.isSafeInteger(version) && version >= 0
    ? parsed.data
    : refused('malformed_command', { why: 'expected_version' });
}

type Owned = { readonly harnessId: string; readonly personId: string };

async function ownedHarness(
  ports: SettingsPorts,
  tx: StoreTransaction,
  caller: Caller,
  harnessId: string,
  at: Date,
): Promise<Owned | Refused> {
  const harness = await tx.harnesses.read.byId(harnessId);
  if (harness === null) return refused('harness_not_found', { harnessId });
  const { actor } = caller;
  const denied = refused('not_permitted', { why: 'not_the_person' });
  if (isAgent(actor) || !actor.interactive || actor.personId === null) return denied;
  if (harness.personId === null || actor.personId !== harness.personId) return denied;
  const grants = await ports.grants.lockAndReread(tx, actor.personId, at);
  return grants.length > 0 ? { harnessId: harness.id, personId: harness.personId } : denied;
}

async function customiseIn(
  ports: SettingsPorts,
  tx: StoreTransaction,
  caller: Caller,
  input: CustomiseInput,
  at: Date,
): Promise<KernelOutcome<AssistantSettingsRow>> {
  const owned = await ownedHarness(ports, tx, caller, input.harnessId, at);
  if ('status' in owned) return owned;
  const before = await tx.assistantSettings.read.byHarness(owned.harnessId);
  const version = before?.version ?? 0;
  if (version !== input.expectedVersion) return refused('stale_version', { version });
  const fields = changedFields(before, input.settings);
  if (before !== null && fields.length === 0) return accepted(before);
  const row = { ...owned, ...input.settings, version: version + 1, updatedAt: at };
  if (!(await tx.assistantSettings.write.upsert(row, version))) {
    return refused('stale_version', { version });
  }
  await recordHarnessEvents(tx, recordContext(ports, caller, at), owned.harnessId, [
    draft('assistant_customised', { fields: [...fields] }),
  ]);
  return accepted(row);
}

export async function customise(
  ports: SettingsPorts,
  caller: Caller,
  input: CustomiseInput,
): Promise<KernelOutcome<AssistantSettingsRow>> {
  const settings = inputRefusal(input);
  if ('status' in settings) return settings;
  const at = ports.clock.now();
  return ports.store.transaction((tx) =>
    customiseIn(ports, tx, caller, { ...input, settings }, at),
  );
}
