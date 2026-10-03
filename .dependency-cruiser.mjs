import { engineRules } from './tools/architecture/cruise/engines.mjs';
import { githubRules } from './tools/architecture/cruise/github.mjs';
import { hostRules } from './tools/architecture/cruise/hosts.mjs';
import { layerRules } from './tools/architecture/cruise/layers.mjs';

export default {
  forbidden: [...layerRules, ...hostRules, ...githubRules, ...engineRules],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '/dist/' },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      mainFields: ['module', 'main', 'types'],
    },
  },
};
