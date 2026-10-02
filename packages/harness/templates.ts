import type { Template } from './template-property.ts';
import { bml } from './templates/bml.ts';
import { software } from './templates/software.ts';

export type { Template };

export const templates: ReadonlyMap<string, Template> = new Map<string, Template>([
  [software.key, software],
  [bml.key, bml],
]);
