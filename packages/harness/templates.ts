import type { WalkStage } from './walk.ts';

export type Template = {
  readonly key: string;
  readonly title: string;
  readonly stages: readonly WalkStage[];
};

export const templates: ReadonlyMap<string, Template> = new Map<string, Template>();
