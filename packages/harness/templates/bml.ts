import type { Template } from '../template-property.ts';
import { eightStages } from './eight-stages.ts';

export const bml: Template = eightStages(
  'bml',
  'BML product flywheel',
  [
    'Goal, strategy, data',
    'Niche identification',
    'Product tuning',
    'Asset package',
    'Brand and policy checks',
    'Deploy to channels',
    'Collect feedback',
    'Analyze, compare',
  ],
  'publish',
);
