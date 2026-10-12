import { bml } from './templates/bml.ts';
import { software } from './templates/software.ts';
import type { Template } from './templates/types.ts';

export type { Template };

export const templates: ReadonlyMap<string, Template> = new Map<string, Template>([
  [software.key, software],
  [bml.key, bml],
]);
