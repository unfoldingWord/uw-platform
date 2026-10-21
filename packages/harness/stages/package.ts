import type { Stage } from '@uw/contracts';

export function hasPackageStage(stages: readonly Pick<Stage, 'bracket'>[]): boolean {
  return stages.some((stage) => stage.bracket === 'product_package');
}
