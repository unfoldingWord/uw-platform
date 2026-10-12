import type { AgentPickup, StageBracket } from '@uw/contracts';
import type { WalkStage } from '../walk.ts';

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
