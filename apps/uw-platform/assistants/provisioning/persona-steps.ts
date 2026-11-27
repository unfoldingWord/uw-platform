import { identitySchema, jdAreaSchema } from '@uw/contracts';
import { assistantPersonaDraft } from '@uw/harness';
import { suggestAssistantPersona } from '../../pages/assistant-persona.ts';
import { assistLive, harnessAreaOf, personaState, type AccountWork } from './rows.ts';
import { done, failed, type ProvisionerDeps, type StepOutcome } from './types.ts';

async function suggested(deps: ProvisionerDeps, work: AccountWork) {
  const state = await personaState(deps.db, work);
  if (state.kind !== 'none') return state;
  const area = jdAreaSchema.safeParse(await harnessAreaOf(deps.db, work.harnessId));
  if (!area.success) return null;
  const harness = { id: work.harnessId, jdArea: area.data, personId: work.personId };
  const owner = identitySchema.parse(`human:${work.personId}`);
  const page = await suggestAssistantPersona(
    deps.db,
    { pageId: deps.newId(), jdArea: area.data, draft: assistantPersonaDraft(harness, owner) },
    {
      actor: deps.caller.actor,
      traceId: deps.caller.traceId,
      requestId: null,
      at: deps.clock.now(),
    },
  );
  if (page.status === 'active') return { kind: 'active' as const };
  return { kind: 'suggested' as const, pageId: page.pageId, version: page.version };
}

export async function persona(deps: ProvisionerDeps, work: AccountWork): Promise<StepOutcome> {
  const state = await suggested(deps, work);
  if (state === null) return failed('persona_refused');
  if (state.kind === 'active') return done;
  const activated = await deps.kernel.assistants.activatePersona(deps.caller, {
    harnessId: work.harnessId,
    pageId: state.pageId,
    expectedVersion: state.version,
  });
  return activated.status === 'accepted' ? done : failed('persona_refused');
}

export async function assist(deps: ProvisionerDeps, work: AccountWork): Promise<StepOutcome> {
  return (await assistLive(deps.db, work, deps.clock.now())) ? done : { kind: 'waiting' };
}
