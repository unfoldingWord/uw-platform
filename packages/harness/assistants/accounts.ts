import {
  assistantHarnessKey,
  assistantNameRefusal,
  harnessSchema,
  nextAssistantJdId,
  type Harness,
  type JdArea,
} from '@uw/contracts';
import { isAgent } from '../access.ts';
import type { Caller } from '../caller.ts';
import { draft, recordContext, recordHarnessEvents, type RecordContext } from '../items/record.ts';
import type { KernelSettings } from '../kernel-settings.ts';
import { lockKeys } from '../lock-keys.ts';
import { accepted, refused, type KernelOutcome, type Refused } from '../outcome.ts';
import { storeRefusalOf } from '../port-errors.ts';
import type { AssistantAccountRow, Ports, StoreTransaction } from '../ports.ts';
import { harnessOf } from '../stages/activate.ts';
import { insertPersonalHarness, retitlePersonal } from '../stages/personal.ts';
import { assistantTemplate } from './role.ts';

type AccountPorts = Pick<Ports, 'clock' | 'grants' | 'ids' | 'store'>;

export type EnableInput = { readonly harnessId: string; readonly name: string };
export type Enabled = {
  readonly harnessId: string;
  readonly jdId: string;
  readonly name: string;
  readonly created: boolean;
  readonly restored: boolean;
};

type Enabling = {
  readonly ports: AccountPorts;
  readonly tx: StoreTransaction;
  readonly context: RecordContext;
  readonly personId: string;
  readonly area: JdArea;
  readonly input: EnableInput;
};

export function actingPerson(caller: Caller): string | Refused {
  const { actor } = caller;
  const denied = refused('not_permitted', { actor: actor.identity });
  if (isAgent(actor) || !actor.interactive || actor.personId === null) return denied;
  return actor.personId;
}

function assistantTitle(jdId: string, name: string): string {
  return `${jdId} ${name.charAt(0).toUpperCase()}${name.slice(1)}`;
}

function enabledOf(row: AssistantAccountRow, created: boolean, restored: boolean): Enabled {
  if (row.jdId === null) throw new RangeError('an enabled assistant holds a JD id');
  return { harnessId: row.harnessId, jdId: row.jdId, name: row.name, created, restored };
}

async function restore(e: Enabling, row: AssistantAccountRow): Promise<KernelOutcome<Enabled>> {
  const { tx, context } = e;
  const renamed = row.name !== e.input.name;
  if (renamed && (await tx.assistantAccounts.read.nameHolder(e.input.name)) !== null) {
    return refused('assistant_name_taken', { field: 'name' });
  }
  const next: AssistantAccountRow = {
    ...row,
    name: e.input.name,
    status: 'enabled',
    disabledAt: null,
    version: row.version + 1,
    updatedAt: context.at,
  };
  if (!(await tx.assistantAccounts.write.update(next, row.version))) {
    return refused('stale_version', { harnessId: row.harnessId });
  }
  const enabled = enabledOf(next, false, true);
  if (renamed) await personalHarness(e, enabled.jdId);
  await recordHarnessEvents(tx, context, row.harnessId, [
    draft('assistant_enabled', { jdId: enabled.jdId, restored: true }),
  ]);
  return accepted(enabled);
}

async function personalHarness(e: Enabling, jdId: string): Promise<Harness> {
  const title = assistantTitle(jdId, e.input.name);
  const held = await e.tx.harnesses.read.byPerson(e.personId);
  if (held !== null) {
    await retitlePersonal(e.tx, e.context, held, title);
    return { ...held, title };
  }
  const harness = harnessOf(
    {
      harnessId: e.input.harnessId,
      harnessKey: assistantHarnessKey(e.personId),
      title,
      jdArea: e.area,
      template: assistantTemplate,
      repository: null,
      requiredChecks: [],
      personId: e.personId,
    },
    [],
  );
  await insertPersonalHarness(e.tx, e.context, harness, assistantTemplate);
  return harness;
}

async function create(
  e: Enabling,
  earlier: AssistantAccountRow | null,
): Promise<KernelOutcome<Enabled>> {
  const { tx, context } = e;
  if ((await tx.assistantAccounts.read.nameHolder(e.input.name)) !== null) {
    return refused('assistant_name_taken', { field: 'name' });
  }
  const jdId = nextAssistantJdId(await tx.assistantAccounts.read.takenJdIds());
  if (jdId === null) return refused('not_permitted', { why: 'jd_ids_spent' });
  const harness = await personalHarness(e, jdId);
  const row: AssistantAccountRow = {
    harnessId: harness.id,
    personId: e.personId,
    name: e.input.name,
    jdId,
    status: 'enabled',
    disabledAt: null,
    deletedAt: null,
    version: (earlier?.version ?? 0) + 1,
    createdAt: earlier?.createdAt ?? context.at,
    updatedAt: context.at,
  };
  if (earlier === null) await tx.assistantAccounts.write.insert(row);
  else if (!(await tx.assistantAccounts.write.update(row, earlier.version))) {
    return refused('stale_version', { harnessId: harness.id });
  }
  await recordHarnessEvents(tx, context, harness.id, [
    draft('assistant_enabled', { jdId, restored: false }),
  ]);
  return accepted(enabledOf(row, earlier === null, false));
}

async function enableIn(e: Enabling): Promise<KernelOutcome<Enabled>> {
  const grants = await e.ports.grants.lockAndReread(e.tx, e.personId, e.context.at);
  if (grants.length === 0) return refused('not_permitted', { why: 'person_inactive' });
  await e.tx.lock(lockKeys.assistantJdAllocation());
  const row = await e.tx.assistantAccounts.read.byPerson(e.personId);
  if (row?.status === 'enabled') {
    if (row.name !== e.input.name) return refused('not_permitted', { why: 'assistant_enabled' });
    return accepted(enabledOf(row, false, false));
  }
  if (row?.status === 'disabled') return restore(e, row);
  return create(e, row);
}

function inputRefusal(input: EnableInput): Refused | null {
  if (!harnessSchema.shape.id.safeParse(input.harnessId).success) {
    return refused('malformed_command', { field: 'harnessId' });
  }
  const why = typeof input.name === 'string' ? assistantNameRefusal(input.name) : 'name_invalid';
  return why === null ? null : refused('malformed_command', { field: 'name', why });
}

const takenConstraints: ReadonlySet<string> = new Set(['assistant_accounts_name_once']);

export async function enable(
  ports: AccountPorts,
  settings: KernelSettings,
  caller: Caller,
  input: EnableInput,
): Promise<KernelOutcome<Enabled>> {
  const area = harnessSchema.shape.jdArea.safeParse(settings.assistantsArea);
  if (!area.success) return refused('not_wired', { why: 'assistants_area_not_configured' });
  const personId = actingPerson(caller);
  if (typeof personId !== 'string') return personId;
  const malformed = inputRefusal(input);
  if (malformed !== null) return malformed;
  const context = recordContext(ports, caller, ports.clock.now());
  try {
    return await ports.store.transaction((tx) =>
      enableIn({ ports, tx, context, personId, area: area.data, input }),
    );
  } catch (error) {
    const store = storeRefusalOf(error);
    if (store === null) throw error;
    if (takenConstraints.has(store.constraint ?? '')) return refused('assistant_name_taken');
    return refused('harness_exists', { constraint: store.constraint });
  }
}
