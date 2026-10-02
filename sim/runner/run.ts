import { databaseErrorFacts } from '@uw/db/errors';
import type { Scenario, ScenarioReport } from '../scenario.ts';
import type { World } from '../world.ts';

export type LoadedScenario = { readonly name: string; readonly scenario: Scenario };

export type ScenarioResult = {
  readonly name: string;
  readonly title: string;
  readonly report: ScenarioReport | null;
  readonly failure: string | null;
};

export function selectScenarios(
  all: readonly LoadedScenario[],
  selector: string,
): LoadedScenario[] {
  if (selector === 'all') return [...all];
  return all.filter((loaded) => loaded.name === selector || loaded.scenario.id === selector);
}

function failureOf(error: unknown): string {
  const facts = databaseErrorFacts(error);
  if (facts === null) return error instanceof Error ? error.message : String(error);
  const details = [
    facts.code === null ? null : `SQLSTATE ${facts.code}`,
    facts.constraint === null ? null : `constraint ${facts.constraint}`,
  ].filter((detail) => detail !== null);
  return details.length === 0 ? facts.name : `${facts.name} (${details.join(', ')})`;
}

export async function runScenario(
  loaded: LoadedScenario,
  openWorld: () => Promise<World>,
): Promise<ScenarioResult> {
  const { name, scenario } = loaded;
  const world = await openWorld();
  try {
    return { name, title: scenario.title, report: await scenario.run(world), failure: null };
  } catch (error) {
    return { name, title: scenario.title, report: null, failure: failureOf(error) };
  } finally {
    await world.close();
  }
}
