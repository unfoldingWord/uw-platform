import type { IssueRef, Principal } from '@uw/contracts';
import { software, type Caller, type CommentInput, type KernelOutcome } from '@uw/harness';
import { createSimHarness, simAdvance, simCaller, simIngest, simPerson } from './fixtures.ts';
import { value } from './runs.ts';
import type { World } from './world.ts';

const area = { scopeKind: 'jd_area', scopeArea: '80-89' } as const;
const toCheck = ['package', 'scope', 'plan', 'build'];

export type TopicScene = {
  readonly world: World;
  readonly harnessId: string;
  readonly ian: Principal;
  readonly areaAdmin: Principal;
  resubmit(itemId: string): Promise<void>;
  parkIssue(issue: IssueRef): Promise<string>;
};

async function submitOnce(world: World, actor: Principal, itemId: string): Promise<void> {
  const caller = simCaller(world, actor);
  value(await world.kernel.items.claim(caller, { itemId, delegationId: null }));
  value(await world.kernel.items.submit(caller, { itemId, to: null, evidence: {}, change: null }));
}

export async function topicScene(world: World): Promise<TopicScene> {
  const { harness, admin: ian } = await createSimHarness(world, software);
  const areaAdmin = await simPerson(world, 5, [{ role: 'admin', ...area }]);
  const gated = await world.kernel.stages.updateStage(simCaller(world, ian), {
    harnessId: harness.id,
    stageKey: 'check',
    change: { exitGate: 'human_approval' },
  });
  value(gated);
  const harnessId = harness.id;
  return {
    world,
    harnessId,
    ian,
    areaAdmin,
    resubmit: (itemId) => submitOnce(world, ian, itemId),
    parkIssue: async (issue) => {
      const imported = await world.kernel.items.importIssue(simCaller(world, simIngest()), {
        harnessId,
        issue,
        title: 'Wire the board',
        pageId: null,
        doneWhen: ['The board lists every stage.'],
      });
      const { itemId } = value(imported).item;
      await simAdvance(world, { harnessId, itemId, worker: ian, through: [...toCheck, 'check'] });
      return itemId;
    },
  };
}

export async function gatedCheck(scene: TopicScene, title: string): Promise<string> {
  const { world, harnessId, ian } = scene;
  const enqueued = await world.kernel.items.enqueue(simCaller(world, ian), {
    harnessId,
    title,
    pageId: null,
    priority: 1,
    due: null,
    delegationId: null,
  });
  const { itemId } = value(enqueued);
  await simAdvance(world, { harnessId, itemId, worker: ian, through: toCheck });
  return itemId;
}

export async function parkAtCheck(scene: TopicScene, title: string): Promise<string> {
  const itemId = await gatedCheck(scene, title);
  await submitOnce(scene.world, scene.ian, itemId);
  return itemId;
}

export function commentOn(
  scene: Pick<TopicScene, 'world' | 'harnessId'>,
  caller: Caller,
  itemId: string | null,
  change: Partial<Omit<CommentInput, 'harnessId' | 'itemId'>>,
): Promise<KernelOutcome<{ readonly eventId: string }>> {
  return scene.world.kernel.items.recordComment(caller, {
    harnessId: scene.harnessId,
    itemId,
    messageId: 1201,
    topic: 'software/item-00000000',
    personId: null,
    email: 'person5@unfoldingword.org',
    text: 'Looks right to me.',
    ...change,
  });
}
