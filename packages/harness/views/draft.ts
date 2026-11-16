import type { DraftProblem, DraftStage } from '@uw/contracts';
import { allowed, isAgent } from '../access.ts';
import type { Caller } from '../caller.ts';
import { draftProblems } from '../stages/drafts/check.ts';
import { lockActive } from '../stages/drafts/shape.ts';
import { accepted, type KernelOutcome } from '../outcome.ts';
import type { StoreTransaction } from '../ports.ts';
import { harnessScene, type ScenePorts } from '../reads/scene.ts';

export type DraftHolder = { readonly personId: string; readonly name: string };

export type WorkflowDraftView = {
  readonly holder: DraftHolder;
  readonly startedAt: Date;
  readonly lockActive: boolean;
  readonly mine: boolean;
  readonly admin: boolean;
  readonly revision: number;
  readonly stages: readonly DraftStage[];
  readonly problems: readonly DraftProblem[];
};

export async function workflowDraft(
  ports: ScenePorts,
  tx: StoreTransaction,
  caller: Caller,
  harnessId: string,
  at: Date,
): Promise<KernelOutcome<WorkflowDraftView | null>> {
  const scene = await harnessScene(ports, tx, caller, harnessId, at);
  if (scene.status !== 'accepted') return scene;
  const { harness, stages: live } = scene.value;
  const held = await tx.workflowDrafts.read.forHarness(harness.id);
  if (held === null) return accepted(null);
  const admin = !isAgent(caller.actor) && allowed(caller.actor, 'admin', harness, at);
  return accepted({
    holder: { personId: held.holderPersonId, name: held.holderName },
    startedAt: held.startedAt,
    lockActive: lockActive(held.touchedAt, at),
    mine: held.holderPersonId === caller.actor.personId,
    admin,
    revision: held.revision,
    stages: admin ? held.stages : [],
    problems: admin ? await draftProblems(tx, harness, live, held.stages) : [],
  });
}
