import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Scenario } from '../scenario.ts';
import type { LoadedScenario } from './run.ts';

const scenarioFilePattern = /^([A-Z]{2}-\d+)\.([a-z0-9-]+)\.ts$/;

function isScenario(value: unknown): value is Scenario {
  if (typeof value !== 'object' || value === null) return false;
  return (
    typeof Reflect.get(value, 'id') === 'string' &&
    typeof Reflect.get(value, 'title') === 'string' &&
    typeof Reflect.get(value, 'run') === 'function'
  );
}

async function load(directory: string, file: string): Promise<LoadedScenario> {
  const match = scenarioFilePattern.exec(file);
  if (!match) {
    throw new Error(`sim/scenarios holds ${file}, which is not named <requirement ID>.<slug>.ts`);
  }
  const module: unknown = await import(pathToFileURL(join(directory, file)).href);
  const scenario: unknown =
    typeof module === 'object' && module !== null ? Reflect.get(module, 'scenario') : undefined;
  if (!isScenario(scenario)) throw new Error(`${file} exports no scenario`);
  if (scenario.id !== match[1]) {
    throw new Error(`${file} declares scenario ${scenario.id}; its file name says ${match[1]}`);
  }
  return { name: file.slice(0, -'.ts'.length), scenario };
}

export async function discoverScenarios(directory: string): Promise<LoadedScenario[]> {
  const files = readdirSync(directory)
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
    .sort();
  const loaded: LoadedScenario[] = [];
  for (const file of files) loaded.push(await load(directory, file));
  return loaded;
}
