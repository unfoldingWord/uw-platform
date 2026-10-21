import { delegableExit, type ExitShape } from './gates/delegable.ts';
import { effectPaths, walk, type WalkStage } from './walk.ts';

export type TemplateViolation = { readonly path: readonly string[]; readonly effectStage: string };

export function templateProperty(stages: readonly WalkStage[]): readonly TemplateViolation[] {
  return effectPaths(walk(stages))
    .filter((effect) => effect.steps.at(-1)?.exitGate !== 'human_approval')
    .map((effect) => {
      const path = effect.steps.map((entry) => entry.key);
      return { path, effectStage: path.at(-1) ?? '' };
    });
}

export function describeViolation(violation: TemplateViolation): string {
  return `path ${violation.path.join(' > ')} reaches ${violation.effectStage}, which has an external effect, without a human_approval exit`;
}

export function delegationProperty(
  stages: readonly WalkStage[],
  delegable: (stage: ExitShape) => boolean = delegableExit,
): readonly TemplateViolation[] {
  return effectPaths(walk(stages))
    .filter((effect) => {
      const last = effect.steps.at(-1);
      return last !== undefined && last.connector !== 'merge' && delegable(last);
    })
    .map((effect) => {
      const path = effect.steps.map((entry) => entry.key);
      return { path, effectStage: path.at(-1) ?? '' };
    });
}

export function describeDelegationViolation(violation: TemplateViolation): string {
  return `path ${violation.path.join(' > ')} reaches ${violation.effectStage}, whose connector is not merge, through an exit a delegation could take`;
}
