import { delegationIdOf } from '@uw/contracts';
import type { ExternalWriter } from '../../pages/provenance.ts';
import { callerOf, type McpHost, type VerbContext } from '../context.ts';

const writesExternal: ReadonlySet<McpHost> = new Set(['external']);

export async function externalWriter(context: VerbContext): Promise<ExternalWriter | null> {
  if (!writesExternal.has(context.host)) return null;
  const delegationId = delegationIdOf(context.principal.identity);
  if (delegationId === null) return null;
  const caller = callerOf(context);
  const beat = await context.kernel.delegations.beat(caller, { delegationId });
  if (beat.status !== 'accepted' || beat.value.delegation.capability !== 'review') return null;
  const { harnessId } = beat.value.delegation;
  const scene = await context.kernel.reads.harness(caller, { harnessId }, { at: context.at });
  return { repository: scene.status === 'accepted' ? scene.value.harness.repository : null };
}
