import type { Harness, Stage } from '@uw/contracts';
import { allowed, isAgent } from '../access.ts';
import type { Caller } from '../caller.ts';
import { accepted, type KernelOutcome } from '../outcome.ts';
import type { PageTitle, StoreTransaction } from '../ports.ts';
import { harnessScene, type ScenePorts } from '../reads/scene.ts';
import { lockActive } from '../stages/drafts/shape.ts';
import { validatorRegistry } from '../validators/registry.ts';
import type { DraftHolder } from './draft.ts';

export type OpenDraft = DraftHolder & { readonly lockActive: boolean };

export type StageControlsView = {
  readonly harness: Harness;
  readonly stages: readonly Stage[];
  readonly skillPages: readonly PageTitle[];
  readonly validators: readonly string[];
  readonly admin: boolean;
  readonly draft: OpenDraft | null;
};

export async function stageControls(
  ports: ScenePorts,
  tx: StoreTransaction,
  caller: Caller,
  harnessId: string,
  at: Date,
): Promise<KernelOutcome<StageControlsView>> {
  const scene = await harnessScene(ports, tx, caller, harnessId, at);
  if (scene.status !== 'accepted') return scene;
  const { harness, stages } = scene.value;
  const held = await tx.workflowDrafts.read.forHarness(harness.id);
  return accepted({
    harness,
    stages: [...stages].sort((a, b) => a.position - b.position),
    skillPages: await tx.pages.read.skillsFor(harness.jdArea),
    validators: [...validatorRegistry.keys()].sort(),
    admin: !isAgent(caller.actor) && allowed(caller.actor, 'admin', harness, at),
    draft:
      held === null
        ? null
        : {
            personId: held.holderPersonId,
            name: held.holderName,
            lockActive: lockActive(held.touchedAt, at),
          },
  });
}
