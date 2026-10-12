import { effectPaths, walk, type Template, type WalkStep } from '@uw/harness';

function describeStep(step: WalkStep): string {
  const name = step.revisited ? `${step.key} again` : step.key;
  const exit = step.connector === 'none' ? step.exitGate : `${step.exitGate}, ${step.connector}`;
  return `${name} [${exit}]`;
}

export function formatTemplateWalk(template: Template): string {
  const paths = effectPaths(walk(template.stages));
  const head = `template ${template.key} (${template.title})`;
  if (paths.length === 0) return `${head}: no path reaches an external effect`;
  const noun = paths.length === 1 ? 'path' : 'paths';
  return [
    `${head}: ${paths.length} ${noun} to an external effect`,
    ...paths.map((path, index) => `  ${index + 1}. ${path.steps.map(describeStep).join(' > ')}`),
  ].join('\n');
}
