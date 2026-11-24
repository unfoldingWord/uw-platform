import type { CapabilityWord } from '@uw/contracts';
import { engineDescriptor, type RunScene } from '@uw/harness';
import type { Checkout } from '../engines/seam.ts';
import type { RunDeps } from './deps.ts';

type GitHubAccess = {
  readonly token: () => Promise<string | null>;
  readonly unwired: (host: string, path: string) => void;
};

export type BuilderAccess = {
  readonly checkout: Checkout | null;
  readonly github: GitHubAccess | null;
};

export type PulledChange = {
  readonly pullRequest: { readonly repo: string; readonly number: number };
  readonly head: string;
};

const building: ReadonlySet<CapabilityWord> = new Set<CapabilityWord>(['build', 'fix']);

const none: BuilderAccess = { checkout: null, github: null };

function branchOf(scene: RunScene): string {
  return `harness/${scene.item.itemId}`;
}

function builds(scene: RunScene): string | null {
  const { harness, capability, persona } = scene;
  if (!building.has(capability) || !engineDescriptor(persona.engine).needsHostedBuilder) {
    return null;
  }
  return harness.repository;
}

export async function builderAccess(
  deps: RunDeps,
  scene: RunScene,
  step: 'scout' | 'work',
): Promise<BuilderAccess> {
  const repository = step === 'work' ? builds(scene) : null;
  if (repository === null) return none;
  const defaultBranch = await deps.builder.defaultBranch(repository);
  if (defaultBranch === null) {
    deps.logger.warn('no default branch for the hosted Builder', {
      outcome: 'builder_default_branch_unknown',
      repository,
    });
    return none;
  }
  const branch = branchOf(scene);
  const unwired = (host: string, path: string) =>
    deps.logger.warn('github egress not wired', { outcome: 'github_egress_not_wired', host, path });
  return {
    checkout: {
      repository,
      branch,
      defaultBranch,
      expectedHead: scene.item.expectedHead,
      fix: scene.capability === 'fix',
    },
    github: { token: deps.builder.token(repository), unwired },
  };
}

export async function pulledChange(deps: RunDeps, scene: RunScene): Promise<PulledChange | null> {
  const repository = builds(scene);
  if (repository === null) return null;
  const open = await deps.builder.openPullRequest(repository, branchOf(scene));
  if (open === null) return null;
  return { pullRequest: { repo: repository, number: open.number }, head: open.head };
}
