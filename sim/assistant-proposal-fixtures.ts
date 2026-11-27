import type { AssistantProposalDecision, Principal } from '@uw/contracts';
import { seedPage } from '@uw/db/test-seed';
import type { AssistantProposalRow } from '@uw/harness';
import type { AssistantScene } from './assistant-fixtures.ts';
import type { OpenTurn } from './assistant-reminder-fixtures.ts';
import { simCaller, simSystem } from './fixtures.ts';

export type Mail = {
  readonly to: readonly string[];
  readonly subject: string;
  readonly body: string;
};

function turnOf(open: OpenTurn) {
  return { requestId: open.id, turnId: open.turn.turnId };
}

export function proposeEmail(scene: AssistantScene, open: OpenTurn, mail: Mail) {
  const { world } = scene;
  return world.kernel.assistants.proposeEmail(simCaller(world, open.turn.principal), {
    ...turnOf(open),
    payload: mail,
  });
}

export function proposeInvite(scene: AssistantScene, open: OpenTurn, invite: object) {
  const { world } = scene;
  return world.kernel.assistants.proposeInvite(simCaller(world, open.turn.principal), {
    ...turnOf(open),
    payload: invite,
  });
}

export function proposePageAppend(scene: AssistantScene, open: OpenTurn, append: object) {
  const { world } = scene;
  return world.kernel.assistants.proposePageAppend(simCaller(world, open.turn.principal), {
    ...turnOf(open),
    payload: append,
  });
}

export function proposalOf(
  scene: AssistantScene,
  proposalId: string,
): Promise<AssistantProposalRow | null> {
  return scene.world.adapters.store.transaction((tx) =>
    tx.assistantProposals.read.byId(proposalId),
  );
}

export async function decide(
  scene: AssistantScene,
  actor: Principal,
  proposalId: string,
  decision: AssistantProposalDecision,
  digest?: string,
) {
  const { world } = scene;
  const held = digest ?? (await proposalOf(scene, proposalId))?.digest ?? '';
  return world.kernel.assistants.decideProposal(simCaller(world, actor), {
    proposalId,
    decision,
    digest: held,
  });
}

export function expireDue(scene: AssistantScene, limit = 50) {
  const { world } = scene;
  return world.kernel.assistants.expireProposals(simCaller(world, simSystem()), { limit });
}

export async function seedNotesPage(
  scene: AssistantScene,
  page: { readonly id: string; readonly jdArea: string; readonly bodyMd: string },
): Promise<void> {
  await seedPage(scene.world.database.db, {
    id: page.id,
    type: 'project',
    status: 'active',
    jdArea: page.jdArea,
    slug: `notes-${page.id.slice(-4)}`,
    title: 'Project notes',
    bodyMd: page.bodyMd,
  });
  scene.world.adapters.pageAppends.addPage(page.id, page.jdArea, page.bodyMd);
}
