import { templates, type Template } from '@uw/harness';
import { formatTemplateWalk } from '../runner/walk-report.ts';

function print(chosen: readonly Template[]): void {
  for (const template of chosen) process.stdout.write(`${formatTemplateWalk(template)}\n`);
}

function main(args: readonly string[]): number {
  const selector = args.find((arg) => arg !== '--');
  if (selector === undefined) {
    process.stderr.write('usage: pnpm walk -- <template | all>\n');
    return 1;
  }
  if (selector === 'all') {
    if (templates.size === 0) process.stdout.write('no templates registered yet\n');
    print([...templates.values()]);
    return 0;
  }
  const template = templates.get(selector);
  if (!template) {
    const registered = [...templates.keys()].join(', ') || 'none';
    process.stderr.write(`unknown template ${selector}; registered: ${registered}\n`);
    return 1;
  }
  print([template]);
  return 0;
}

process.exitCode = main(process.argv.slice(2));
