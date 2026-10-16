import type { FindingWeight, Principal, PullRequestDeclaration } from '@uw/contracts';
import type { KernelOutcome } from '@uw/harness';
import { simAgent, simCaller, simDelegate } from './fixtures.ts';
import { reviewWorld, type ReviewWorld } from './review-runs.ts';
import { builderFrontmatter, seedPersona, value } from './runs.ts';
import { greenFacts, shipBase, shipPullRequest, simSha } from './ship-fixtures.ts';
import type { World } from './world.ts';

export const fixerPage = '00000000-0000-4000-8000-000000017001';
export const fixHead = simSha('f1ed');
const roundText = 'The board drops its empty state.';

export type FixWorld = ReviewWorld & { readonly fixer: Principal; readonly fixId: string };

export type FixOptions = { readonly fixClaim?: boolean; readonly weight?: FindingWeight };

export async function reviewedRound(scene: ReviewWorld, weight: FindingWeight): Promise<void> {
  const input = {
    verdict: 'request_changes' as const,
    findings: [{ text: roundText, weight }],
    resolvedProvider: 'deepinfra',
    resolvedModel: 'z-ai/glm-5.3',
  };
  value(await scene.world.kernel.runs.postReview(scene.host, scene.runId, input));
}

export async function fixWorld(world: World, options: FixOptions = {}): Promise<FixWorld> {
  const scene = await reviewWorld(world);
  await reviewedRound(scene, options.weight ?? 'real');
  if (options.fixClaim !== false) {
    const admin = simCaller(world, scene.admin);
    value(
      await world.kernel.stages.setFixClaim(admin, { harnessId: scene.harnessId, enabled: true }),
    );
  }
  await seedPersona(scene, { id: fixerPage, frontmatter: builderFrontmatter(scene) });
  const granted = await simDelegate(world, scene.owner, {
    harnessId: scene.harnessId,
    persona: 'agent:builder',
    capability: 'fix',
    expiresAt: null,
    supersedes: null,
  });
  const fixer = simAgent(scene.owner, 'builder', { interactive: false });
  return { ...scene, fixer, fixId: value(granted).id };
}

export function claimFix(scene: FixWorld): Promise<KernelOutcome<unknown>> {
  return scene.world.kernel.items.claim(simCaller(scene.world, scene.fixer), {
    itemId: scene.itemId,
    delegationId: scene.fixId,
  });
}

export async function offeredTo(scene: FixWorld, actor: Principal): Promise<readonly string[]> {
  const polled = await scene.world.kernel.reads.poll(simCaller(scene.world, actor), {
    harnessId: scene.harnessId,
    limit: 10,
  });
  return value(polled).map((entry) => entry.itemId);
}

export function diffText(files: Readonly<Record<string, number>>): string {
  const blocks = Object.entries(files).map(([path, lines]) =>
    [
      `diff --git a/${path} b/${path}`,
      `--- a/${path}`,
      `+++ b/${path}`,
      `@@ -1,${lines.toString()} +1,${lines.toString()} @@`,
      ...Array.from({ length: lines }, (_, n) => `+line ${n.toString()}`),
    ].join('\n'),
  );
  return `${blocks.join('\n')}\n`;
}

export type FixChange = {
  readonly pull: Readonly<Record<string, number>>;
  readonly fix: Readonly<Record<string, number>> | null;
  readonly declaration?: PullRequestDeclaration | null;
};

export function pushedFix(scene: FixWorld, change: FixChange): void {
  const { world, itemId } = scene;
  const declared = change.declaration === undefined ? {} : { declaration: change.declaration };
  world.adapters.githubFacts.given(
    greenFacts(world, { itemId, head: fixHead, reviews: [], ...declared }),
  );
  const pull = { base: shipBase, head: scene.head };
  world.adapters.githubFacts.setDiff(shipPullRequest, pull, diffText(change.pull));
  if (change.fix === null) return;
  const fix = { base: scene.head, head: fixHead };
  world.adapters.githubFacts.setDiff(shipPullRequest, fix, diffText(change.fix));
}

export function submitFix(scene: FixWorld, as: Principal = scene.fixer) {
  return scene.world.kernel.items.submit(simCaller(scene.world, as), {
    itemId: scene.itemId,
    to: null,
    evidence: {},
    change: { pullRequest: shipPullRequest, head: fixHead },
  });
}
