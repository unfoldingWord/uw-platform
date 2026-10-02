import type { Template } from '../template-property.ts';
import { eightStages } from './eight-stages.ts';

export const software: Template = eightStages(
  'software',
  'Software delivery',
  [
    'Backlog issue',
    'Premise verified',
    'Plan approved',
    'Commits to PR',
    'CI and review verdict',
    'Merge, tag, deploy',
    'Deploy watched',
    'Issue closed and learning',
  ],
  'merge',
);
