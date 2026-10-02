import { delegationIdOf, deviceOwnerSegment } from '@uw/contracts';
import type { AclResource } from '@uw/core/acl';
import type { Caller } from '@uw/harness';
import type { VerbContext } from '../context.ts';
import { refusal, type Found, type VerbRefusal } from '../handler.ts';

type ItemInput = { readonly itemId: string };

export function callerOf(context: VerbContext): Caller {
  return { actor: context.principal, traceId: context.traceId };
}

export function hiddenItem(input: ItemInput): VerbRefusal {
  return refusal('item_not_found', { itemId: input.itemId });
}

async function delegationRefusal(context: VerbContext): Promise<VerbRefusal | null> {
  const { principal } = context;
  const delegationId = delegationIdOf(principal.identity);
  if (delegationId === null) {
    const unattendedDevice =
      deviceOwnerSegment(principal.identity) !== null && !principal.interactive;
    return unattendedDevice ? refusal('delegation_required', { actor: principal.identity }) : null;
  }
  const beat = await context.kernel.delegations.beat(callerOf(context), { delegationId });
  return beat.status === 'accepted' ? null : refusal(beat.reason, beat.detail);
}

export async function itemArea(
  context: VerbContext,
  input: ItemInput,
): Promise<Found<null> | VerbRefusal> {
  const scene = await context.kernel.reads.item(callerOf(context), { itemId: input.itemId });
  if (scene.status === 'error') {
    return (await delegationRefusal(context)) ?? refusal(scene.reason, scene.detail);
  }
  return { resource: { kind: 'area', area: scene.value.harness.jdArea }, found: null };
}

export async function harnessAreas(
  context: VerbContext,
  harnessIds: readonly string[],
): Promise<(harnessId: string) => AclResource | null> {
  const areas = new Map<string, AclResource>();
  for (const harnessId of new Set(harnessIds)) {
    const scene = await context.kernel.reads.harness(callerOf(context), { harnessId });
    if (scene.status === 'accepted') {
      areas.set(harnessId, { kind: 'area', area: scene.value.harness.jdArea });
    }
  }
  return (harnessId) => areas.get(harnessId) ?? null;
}
