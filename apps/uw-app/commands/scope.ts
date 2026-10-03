import { z } from 'zod';
import {
  jdAreaSchema,
  type ErrorReason,
  type Harness,
  type JdArea,
  type Stage,
} from '@uw/contracts';
import type { Database } from '@uw/db/client';
import type { Caller, Kernel } from '@uw/harness';
import { readPage } from '../pages/store.ts';
import type { CommandHandler } from './handler.ts';

export type Scene = {
  readonly harness: Harness | null;
  readonly stages: readonly Stage[];
  readonly area: JdArea;
};

type Reads = Pick<Kernel, 'reads'>;
type Lookup = {
  readonly kernel: Reads;
  readonly caller: Caller;
  readonly at: Date;
  readonly db: Database;
};
type Named = { readonly harnessId: string; readonly body: unknown };

const newHarnessArea = z.object({ jdArea: jdAreaSchema });
const optionalId = z.uuid().nullable().optional();
const instructions = z.object({ instructionsPageId: optionalId }).optional();
const namedTargets = z.object({
  itemId: optionalId,
  beforeItemId: optionalId,
  delegationId: optionalId,
  supersedes: optionalId,
  pageId: optionalId,
  stage: instructions,
  change: instructions,
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

async function pageIn(lookup: Lookup, area: JdArea, pageId: string): Promise<boolean> {
  const page = await readPage(lookup.db, lookup.caller.actor, pageId, lookup.at);
  return page !== null && page.jdArea === area;
}

async function foreignItem(lookup: Lookup, harnessId: string, ids: readonly string[]) {
  for (const itemId of ids) {
    if (!(await itemIn(lookup, harnessId, itemId))) return true;
  }
  return false;
}

async function foreignPage(lookup: Lookup, area: JdArea, ids: readonly string[]) {
  for (const pageId of ids) {
    if (!(await pageIn(lookup, area, pageId))) return true;
  }
  return false;
}

async function foreignDelegation(lookup: Lookup, harnessId: string, ids: readonly string[]) {
  for (const delegationId of ids) {
    if (!(await delegationIn(lookup, harnessId, delegationId))) return true;
  }
  return false;
}

export async function foreignTarget(
  lookup: Lookup,
  scene: Scene,
  named: Named,
): Promise<ErrorReason | null> {
  const targets = namedTargets.parse(named.body);
  const items = present([targets.itemId, targets.beforeItemId]);
  if (await foreignItem(lookup, named.harnessId, items)) return 'item_not_found';
  const delegations = present([targets.delegationId, targets.supersedes]);
  if (await foreignDelegation(lookup, named.harnessId, delegations)) return 'delegation_not_found';
  const pages = present([
    targets.pageId,
    targets.stage?.instructionsPageId,
    targets.change?.instructionsPageId,
  ]);
  if (await foreignPage(lookup, scene.area, pages)) return 'page_not_found';
  return null;
}
