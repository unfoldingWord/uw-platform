import { fileURLToPath } from 'node:url';
import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { discoverScenarios } from '../runner/discover.ts';
import { formatResult } from '../runner/report.ts';
import { runScenario, selectScenarios } from '../runner/run.ts';
import { createWorld } from '../world.ts';

const directory = fileURLToPath(new URL('../scenarios/', import.meta.url));

async function main(args: readonly string[]): Promise<number> {
  const selector = args.find((arg) => arg !== '--');
  if (selector === undefined) {
    process.stderr.write('usage: pnpm sim -- <scenario | requirement ID | all>\n');
    return 1;
  }
  const all = await discoverScenarios(directory);
  const chosen = selectScenarios(all, selector);
  if (chosen.length === 0) {
    const known = all.map((loaded) => loaded.name).join(', ');
    process.stderr.write(`no scenario matches ${selector}; known: ${known}\n`);
    return 1;
  }
  let passed = 0;
  for (const loaded of chosen) {
    const result = await runScenario(loaded, () => createWorld());
    process.stdout.write(`${formatResult(result)}\n\n`);
    if (result.failure === null) passed += 1;
  }
  process.stdout.write(`${passed} of ${chosen.length} scenarios passed\n`);
  return passed === chosen.length ? 0 : 1;
}

try {
  process.exitCode = await main(process.argv.slice(2));
} finally {
  await closeEmbeddedTemplate();
}
