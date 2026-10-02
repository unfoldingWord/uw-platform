import { effectPaths, walk, type WalkStage, type WalkStep } from './walk.ts';
import type { AgentPickup, StageBracket } from '@uw/contracts';

export type TemplateStage = WalkStage & {
  readonly title: string;
  readonly bracket: StageBracket;
  readonly agentPickup: AgentPickup;
  readonly wipLimit: number;
  readonly validators: readonly string[];
};

export type Template = {
  readonly key: string;
  readonly title: string;
  readonly stages: readonly TemplateStage[];
};

export type TemplateViolation = { readonly path: readonly string[]; readonly effectStage: string };

function bypassesApproval(steps: readonly WalkStep[]): boolean {
  const effectIndex = steps.length - 1;
  const firstEffect = steps.findIndex((entry) => entry.connector !== 'none');
  const approved = steps.some((entry) => entry.exitGate === 'human_approval');
  return firstEffect === effectIndex && !approved;
}

export function templateProperty(stages: readonly WalkStage[]): readonly TemplateViolation[] {
  return effectPaths(walk(stages))
    .filter((effect) => bypassesApproval(effect.steps))
    .map((effect) => {
      const path = effect.steps.map((entry) => entry.key);
      return { path, effectStage: path[path.length - 1] ?? '' };
    });
}

export function describeViolation(violation: TemplateViolation): string {
  return `path ${violation.path.join(' > ')} reaches ${violation.effectStage}, which has an external effect, without a human_approval exit`;
}
