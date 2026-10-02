import { discoverScenarios } from './discover.ts';
import { formatResult } from './report.ts';
import { runScenario, selectScenarios } from './run.ts';
import { createWorld } from '../world.ts';

export type CommandOutput = {
  out(text: string): void;
  err(text: string): void;
};

export async function simCommand(
  args: readonly string[],
  directory: string,
  output: CommandOutput,
): Promise<number> {
  const selector = args.find((arg) => arg !== '--');
  if (selector === undefined) {
    output.err('usage: pnpm sim -- <scenario | requirement ID | all>\n');
    return 1;
  }
  const all = await discoverScenarios(directory);
  const chosen = selectScenarios(all, selector);
  if (chosen.length === 0) {
    const known = all.map((loaded) => loaded.name).join(', ');
    output.err(`no scenario matches ${selector}; known: ${known}\n`);
    return 1;
  }
  let passed = 0;
  for (const loaded of chosen) {
    const result = await runScenario(loaded, () => createWorld());
    output.out(`${formatResult(result)}\n\n`);
    if (result.failure === null) passed += 1;
  }
  output.out(`${passed} of ${chosen.length} scenarios passed\n`);
  return passed === chosen.length ? 0 : 1;
}
