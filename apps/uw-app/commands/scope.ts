import { z } from 'zod';
import {
  jdAreaSchema,
  type ErrorReason,
  type Harness,
  type JdArea,
  type Stage,
} from '@uw/contracts';
import type { Caller, Kernel } from '@uw/harness';
import type { CommandHandler } from './handler.ts';

export type Scene = {
  readonly harness: Harness | null;
  readonly stages: readonly Stage[];
  readonly area: JdArea;
};

type Reads = Pick<Kernel, 'reads'>;
type Lookup = { readonly kernel: Reads; readonly caller: Caller; readonly at: Date };

const newHarnessArea = z.object({ jdArea: jdAreaSchema });
const optionalId = z.uuid().nullable().optional();
const namedTargets = z.object({
  itemId: optionalId,
  beforeItemId: optionalId,
  delegationId: optionalId,
  supersedes: optionalId,
});

export async function sceneOf(
  lookup: Lookup,
  handler: CommandHandler,
  harnessId: string,
  body: unknown,
): Promise<Scene | ErrorReason> {
  if (handler.scope === 'new_harness') {
    const parsed = newHarnessArea.safeParse(body);
    if (!parsed.success) return 'malformed_command';
    return { harness: null, stages: [], area: parsed.data.jdArea };
  }
  const read = await lookup.kernel.reads.harness(lookup.caller, { harnessId }, { at: lookup.at });
  if (read.status !== 'accepted') return 'harness_not_found';
  return {
    harness: read.value.harness,
    stages: read.value.stages,
    area: read.value.harness.jdArea,
  };
}

function present(ids: readonly (string | null | undefined)[]): string[] {
  return ids.filter((id): id is string => typeof id === 'string');
}

async function itemIn(lookup: Lookup, harnessId: string, itemId: string): Promise<boolean> {
  const read = await lookup.kernel.reads.item(lookup.caller, { itemId }, { at: lookup.at });
  return read.status === 'accepted' && read.value.harness.id === harnessId;
}

async function delegationIn(
  lookup: Lookup,
  harnessId: string,
  delegationId: string,
): Promise<boolean> {
  const read = await lookup.kernel.reads.delegation(
    lookup.caller,
    { delegationId },
    { at: lookup.at },
  );
  return read.status === 'accepted' && read.value.harnessId === harnessId;
}

export async function foreignTarget(
  lookup: Lookup,
  harnessId: string,
  body: unknown,
): Promise<ErrorReason | null> {
  const targets = namedTargets.parse(body);
  for (const itemId of present([targets.itemId, targets.beforeItemId])) {
    if (!(await itemIn(lookup, harnessId, itemId))) return 'item_not_found';
  }
  for (const delegationId of present([targets.delegationId, targets.supersedes])) {
    if (!(await delegationIn(lookup, harnessId, delegationId))) return 'delegation_not_found';
  }
  return null;
}
