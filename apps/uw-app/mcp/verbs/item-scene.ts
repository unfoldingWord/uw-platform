import type { AclResource } from '@uw/core/acl';
import { unattendedWithoutDelegation } from '@uw/harness';
import { callerOf, type VerbContext } from '../context.ts';
import { refusal, type Found, type VerbRefusal } from '../handler.ts';

type ItemInput = { readonly itemId: string };

export function hiddenItem(input: ItemInput): VerbRefusal {
  return refusal('item_not_found', { itemId: input.itemId });
}

function delegationRefusal(context: VerbContext): VerbRefusal | null {
  const { principal } = context;
  if (!unattendedWithoutDelegation(principal)) return null;
  return refusal('delegation_required', { actor: principal.identity });
}

export async function itemArea(
  context: VerbContext,
  input: ItemInput,
): Promise<Found<null> | VerbRefusal> {
  const scene = await context.kernel.reads.item(
    callerOf(context),
    { itemId: input.itemId },
    { at: context.at },
  );
  if (scene.status === 'error') {
    return delegationRefusal(context) ?? refusal(scene.reason, scene.detail);
  }
  return { resource: { kind: 'area', area: scene.value.harness.jdArea }, found: null };
}

export async function harnessAreas(
  context: VerbContext,
  harnessIds: readonly string[],
): Promise<(harnessId: string) => AclResource | null> {
  const areas = new Map<string, AclResource>();
  for (const harnessId of new Set(harnessIds)) {
    const scene = await context.kernel.reads.harness(
      callerOf(context),
      { harnessId },
      { at: context.at },
    );
    if (scene.status === 'accepted') {
      areas.set(harnessId, { kind: 'area', area: scene.value.harness.jdArea });
    }
  }
  return (harnessId) => areas.get(harnessId) ?? null;
}
